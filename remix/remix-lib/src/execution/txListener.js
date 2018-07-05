'use strict'
var async = require('async')
var ethers = require('ethers')
var ethJSUtil = require('ethereumjs-util')
var EventManager = require('../eventManager')
var codeUtil = require('../util')

var executionContext = require('./execution-context')
var txFormat = require('./txFormat')
var txHelper = require('./txHelper')
const ieleTranslator = require('./ieleTranslator')

const RLP = require('rlp')
window['RLP'] = RLP

/**
  * poll web3 each 2s if web3
  * listen on transaction executed event if VM
  * attention: blocks returned by the event `newBlock` have slightly different json properties whether web3 or the VM is used
  * trigger 'newBlock'
  *
  */
class TxListener {
  constructor (opt) {
    this.event = new EventManager()
    this._api = opt.api
    this._resolvedTransactions = {}
    this._resolvedContracts = {}
    this._isListening = false
    this._listenOnNetwork = false
    this._loopId = null
    this.init()
    executionContext.event.register('contextChanged', (context) => {
      if (this._isListening) {
        this.stopListening()
        this.startListening()
      }
    })

    opt.event.udapp.register('callExecuted', (error, from, to, data, lookupOnly, txResult, timestamp, payload) => {
      // console.log('@txListener.js callExecuted event')
      // console.log('* error: ', error)
      // console.log('* from: ', from)
      // console.log('* to: ', to)
      // console.log('* data: ', data)
      // console.log('* lookupOnly: ', lookupOnly)
      // console.log('* txResult: ', txResult)
      // console.log('* timestamp: ', timestamp)
      // console.log('* payload: ', payload)
      // console.log('* contract: ', contract)
      //window['txResult'] = txResult

      if (error) return
      // we go for that case if
      // in VM mode
      // in web3 mode && listen remix txs only
      if (!this._isListening) return // we don't listen
      if (this._loopId && executionContext.getProvider() !== 'vm') return // we seems to already listen on a "web3" network

      let output
      let decodedOutput
      if (executionContext.isVM()) {
        output = txResult.result.vm.return
      } else if (payload.vm === 'ielevm') { // iele vm
        output = txResult.result
      } else { // evm
        output = ethJSUtil.toBuffer(txResult.result)
      }

      const tx = {
        from: from,
        to: to,
        input: data.startsWith('0x') ? data : '0x' + data,
        hash: txResult.transactionHash,
        // @rv: hash here should just be undefined because it's a `call` 
        // hash: txResult.transactionHash ? txResult.transactionHash : 'call' + (from || '') + to + data,
        isCall: true,
        output,
        envMode: executionContext.getProvider()
      }

      addExecutionCosts(txResult, tx)
      this.extendTransactionForIELE(tx, data, lookupOnly, txResult, payload)
      this._resolveTx(tx, (error) => {
        if (!error) {
          this.event.trigger('newCall', [tx])
        }
      })
    })

    opt.event.udapp.register('transactionExecuted', (error, from, to, data, lookupOnly, txResult, timestamp, payload) => {
      if (error) return
      if (lookupOnly) return
      // we go for that case if
      // in VM mode
      // in web3 mode && listen remix txs only
      if (!this._isListening) return // we don't listen
      if (this._loopId && executionContext.getProvider() !== 'vm') return // we seems to already listen on a "web3" network
      executionContext.web3().eth.getTransaction(txResult.transactionHash, (error, tx) => {
        if (error) return console.log(error)

        addExecutionCosts(txResult, tx)
        this.extendTransactionForIELE(tx, data, lookupOnly, txResult, payload)
        tx.envMode = executionContext.getProvider()
        tx.status = txResult.result.status // 0x0 or 0x1
        this._resolve([tx], () => {})
      })
    })
    
    function addExecutionCosts (txResult, tx) {
      if (txResult && txResult.result) {
        if (txResult.result.vm) {
          tx.output = txResult.result.vm.return
          if (txResult.result.vm.gasUsed) tx.executionCost = txResult.result.vm.gasUsed.toString(10)
        }
        if (txResult.result.gasUsed) tx.transactionCost = txResult.result.gasUsed.toString(10)
      }
    }
  }

  /**
   * @rv: This function will add `params` and `decodedOutput` to `tx`
   * @param {object} tx
   * @param {string} input
   * @param {boolean} isCall
   * @param {object} txResult
   * @param {{funAbi: object, funArgs: object, contractBytecode: string, contractName: string, sourceLanguage: string, vm: string}} payload
   */
  extendTransactionForIELE(tx, input, isCall, txResult, payload) {
    // console.log('@extendTransactionForIELE')
    // console.log('* tx: ', tx)
    // console.log('* input: ', input)
    // console.log('* isCall: ', isCall)
    // console.log('* txResult: ', txResult)
    // console.log('* payload: ', payload)
    if (payload.vm !== 'ielevm') {
      return
    }

    let output 
    if (isCall) {
      output = txResult.result
    } else if (!(!tx.to || tx.to === '0x0')) { // not constructor
      output = txResult.result.returnData
    }
    let decodedOutput = RLP.decode(output).map((val)=> '0x' + val.toString('hex'))
    let decodedInput = RLP.decode(input.startsWith('0x') ? input : ('0x' + input))
    let params = decodedInput[1].map((val)=> '0x' + val.toString('hex'))
    if (payload.sourceLanguage === 'solidity') {
      decodedOutput = decodedOutput.map((val, i)=> ieleTranslator.decode(val, payload.funAbi.outputs[i]).result)
      params = params.map((val, i)=> ieleTranslator.decode(val, payload.funAbi.inputs[i]).result)
    }
    decodedOutput = this.formatDecodedOutput(decodedOutput, payload.funAbi.outputs)
    params = this.formatDecodedParams(params, payload.funAbi.inputs)

    tx.decodedOutput = decodedOutput
    tx.params = params
  }

  /**
   * @rv: convert list of decoded values to object
   * @param {object[]} decodedValue 
   * @param {object[]} typeList
   * @return {{[key:string]:any}}
   */
  formatDecodedParams(decodedValue, typeList) {
    if (!decodedValue || !decodedValue.length) {
      return undefined
    }
    const output = {}
    decodedValue.forEach((val, i) => {
      if (typeof(val) === 'object') {
        val = JSON.stringify(val)
      }
      output[`${typeList[i].type} ${typeList[i].name}`] = val
    })
    return output
  }

  /**
   * @rv: convert list of decoded values to object
   * @param {object[]} decodedValue 
   * @param {object[]} typeList
   * @return {{[key:string]:any}}
   */
  formatDecodedOutput(decodedValue, typeList) {
    if (!decodedValue || !decodedValue.length) {
      return undefined
    }
    const output = {}
    decodedValue.forEach((val, i) => {
      if (typeof(val) === 'object') {
        val = JSON.stringify(val)
      }
      if (typeList && typeList[i] && typeList[i].type) {
        output[i] = `${typeList[i].type}: ${val}`
      } else { // iele code doesn't have `outputs` information in abi.
        output[i] = `${val}`
      }
    })
    return output
  }

  /**
    * define if txlistener should listen on the network or if only tx created from remix are managed
    *
    * @param {Bool} type - true if listen on the network
    */
  setListenOnNetwork (listenOnNetwork) {
    this._listenOnNetwork = listenOnNetwork
    if (this._loopId) {
      clearInterval(this._loopId)
    }
    if (this._listenOnNetwork) {
      this._startListenOnNetwork()
    }
  }

  /**
    * reset recorded transactions
    */
  init () {
    this.blocks = []
    this.lastBlock = null
  }

  /**
    * start listening for incoming transactions
    *
    * @param {String} type - type/name of the provider to add
    * @param {Object} obj  - provider
    */
  startListening () {
    this.init()
    this._isListening = true
    if (this._listenOnNetwork && executionContext.getProvider() !== 'vm') {
      this._startListenOnNetwork()
    }
  }

   /**
    * stop listening for incoming transactions. do not reset the recorded pool.
    *
    * @param {String} type - type/name of the provider to add
    * @param {Object} obj  - provider
    */
  stopListening () {
    if (this._loopId) {
      clearInterval(this._loopId)
    }
    this._loopId = null
    this._isListening = false
  }

  _startListenOnNetwork () {
    this._loopId = setInterval(() => {
      var currentLoopId = this._loopId
      executionContext.web3().eth.getBlockNumber((error, blockNumber) => {
        if (this._loopId === null) return
        if (error) return console.log(error)
        if (currentLoopId === this._loopId && (!this.lastBlock || blockNumber > this.lastBlock)) {
          if (!this.lastBlock) this.lastBlock = blockNumber - 1
          var current = this.lastBlock + 1
          this.lastBlock = blockNumber
          while (blockNumber >= current) {
            try {
              this._manageBlock(current)
            } catch (e) {
              console.log(e)
            }
            current++
          }
        }
      })
    }, 2000)
  }

  _manageBlock (blockNumber) {
    executionContext.web3().eth.getBlock(blockNumber, true, (error, result) => {
      if (!error) {
        this._newBlock(Object.assign({type: 'web3'}, result))
      }
    })
  }

  /**
    * try to resolve the contract name from the given @arg address
    *
    * @param {String} address - contract address to resolve
    * @return {String} - contract name
    */
  resolvedContract (address) {
    return this._resolvedContracts[address]
  }

  /**
    * try to resolve the transaction from the given @arg txHash
    *
    * @param {String} txHash - contract address to resolve
    * @return {String} - contract name
    */
  resolvedTransaction (txHash) {
    return this._resolvedTransactions[txHash]
  }

  _newBlock (block) {
    this.blocks.push(block)
    this._resolve(block.transactions, () => {
      this.event.trigger('newBlock', [block])
    })
  }

  _resolve (transactions, callback) {
    async.each(transactions, (tx, cb) => {
      this._resolveTx(tx, (error) => {
        if (error) cb(error)
        this.event.trigger('newTransaction', [tx])
        cb()
      })
    }, () => {
      callback()
    })
  }

  _resolveTx (tx, cb) {
    var contracts = this._api.contracts()
    if (!contracts) return cb()
    var contractName
    // console.log('@txListener.js _resolveTx')
    // console.log('* tx: ', tx)
    if (!tx.to || tx.to === '0x0') { // testrpc returns 0x0 in that case
      // contract creation / resolve using the creation bytes code
      // if web3: we have to call getTransactionReceipt to get the created address
      // if VM: created address already included
      var code = tx.input
      contractName = this._tryResolveContract(code, contracts, true)
      // console.log('* 1 contractName: ', contractName)
      // console.log('* 1 this._resolvedContracts: ', this._resolvedContracts)
      if (contractName) {
        this._api.resolveReceipt(tx, (error, receipt) => {
          // console.log('- this._api.resolveReceipt')
          // console.log('- * receipt, ', receipt)
          if (error) return cb(error)
          var address = receipt.contractAddress
          this._resolvedContracts[address] = contractName
          this._resolveFunction(contractName, contracts, tx, true)
          if (this._resolvedTransactions[tx.hash]) {
            this._resolvedTransactions[tx.hash].contractAddress = address
          }
          return cb()
        })
      } else {
        return cb()
      }
    } else {
      // first check known contract, resolve against the `runtimeBytecode` if not known
      contractName = this._resolvedContracts[tx.to]
      // console.log('* 2 contractName: ', contractName)
      // console.log('* 2 this._resolvedContracts: ', this._resolvedContracts)
      if (!contractName) {
        executionContext.web3().eth.getCode(tx.to, (error, code) => {
          // console.log('- code: ', code)
          if (error) return cb(error)
          if (code) {
            var contractName = this._tryResolveContract(code, contracts, false)
            if (contractName) {
              this._resolvedContracts[tx.to] = contractName
              this._resolveFunction(contractName, contracts, tx, false)
              return cb()
            } else {
              return cb()
            }
          } else {
            return cb()
          }
        })
        return
      } else {
        this._resolveFunction(contractName, contracts, tx, false)
        return cb(null)
      }
    }
  }

  _resolveFunction (contractName, compiledContracts, tx, isCtor) {
    // console.log('@txListener.js _resolveFunction')
    // console.log('* contractName: ', contractName)
    // console.log('* compiledContracts: ', compiledContracts)
    // console.log('* tx: ', tx)
    // console.log('* isCtor: ', isCtor)
    const contract = txHelper.getContract(contractName, compiledContracts)
    if (!contract) {
      console.log('txListener: cannot resolve ' + contractName)
      return
    }
    const isIeleVM = !!(contract.object.vm === 'ielevm')
    const sourceLanguage = contract.object.sourceLanguage
    const abi = contract.object.abi
    const inputData = tx.input.replace(/^0x/, '')
    // console.log('* contract: ', contract)
    // console.log('* isIeleVM: ', isIeleVM)
    // console.log('* abi: ', abi)
    // console.log('* inputData: ', inputData)
    // console.log('* sourceLanguage: ', sourceLanguage)
    if (!isCtor) { // TODO: check this for IELE
      if (isIeleVM) {
        const decoded = RLP.decode('0x' + inputData)
        const fn = decoded[0].toString()
        const inputs = (sourceLanguage === 'solidity') ? getFunctionForSolidity(abi, fn).inputs : getFunctionForIELE(abi, fn).inputs
        // console.log('* fn: ', fn)
        // console.log('* inputs: ', inputs)
        let params 
        if (sourceLanguage === "solidity") {
          params = decoded[1].map((val, i)=> ieleTranslator.decode('0x' + val.toString('hex'), inputs[i]).result)
        } else { // IELE
          params = decoded[1].map((val)=> '0x' + val.toString('hex'))
        }
        params = this.formatDecodedParams(params, inputs)

        this._resolvedTransactions[tx.hash] = {
          contractName: contractName,
          to: tx.to,
          fn,
          params,
          decodedOutput: tx.decodedOutput
        }
        return this._resolvedTransactions[tx.hash]
      } else {
        var methodIdentifiers = contract.object.evm.methodIdentifiers
        for (var fn in methodIdentifiers) {
          if (methodIdentifiers[fn] === inputData.substring(0, 8)) {
            var fnabi = getFunction(abi, fn)
            this._resolvedTransactions[tx.hash] = {
              contractName: contractName,
              to: tx.to,
              fn: fn,
              params: this._decodeInputParams(inputData.substring(8), fnabi)
            }
            if (tx.output) {
              this._resolvedTransactions[tx.hash].decodedOutput = txFormat.decodeResponse(tx.output, fnabi)
            }
            return this._resolvedTransactions[tx.hash]
          }
        }
        // fallback function
        this._resolvedTransactions[tx.hash] = {
          contractName: contractName,
          to: tx.to,
          fn: '(fallback)',
          params: null
        }
      }
    } else {
      if (isIeleVM) {
        const decoded = RLP.decode('0x' + inputData)
        let params 
        if (sourceLanguage === "solidity") {
          params = decoded[1].map((val, i)=> ieleTranslator.decode('0x' + val.toString('hex'), getConstructorInterface(abi).inputs[i]).result)
        } else { // IELE
          params = decoded[1].map((val)=> '0x' + val.toString('hex'))
        }
        params = this.formatDecodedParams(params, getConstructorInterface(abi).inputs)

        this._resolvedTransactions[tx.hash] = {
          contractName,
          to: null,
          fn: '(constructor)',
          params
        }
      } else {
        var bytecode = contract.object.evm.bytecode.object
        var params = null
        if (bytecode && bytecode.length) {
          params = this._decodeInputParams(inputData.substring(bytecode.length), getConstructorInterface(abi))
        }
        this._resolvedTransactions[tx.hash] = {
          contractName: contractName,
          to: null,
          fn: '(constructor)',
          params: params
        }
      }
    }
    return this._resolvedTransactions[tx.hash]
  }

  _tryResolveContract (codeToResolve, compiledContracts, isCreation) {
    // console.log('@txListener.js _tryResolveContract')
    // console.log('* codeToResolve: ', codeToResolve)
    // console.log('* compiledContracts: ', compiledContracts)
    // console.log('* isCreation: ', isCreation)
    var found = null
    txHelper.visitContracts(compiledContracts, (contract) => {
      // console.log('- contract: ', contract)
      const isIeleVM = contract.object.vm === 'ielevm'
      // console.log('- isIeleVM: ', isIeleVM)
      let bytes 
      if (isIeleVM) {
        bytes = contract.object.ielevm.bytecode.object.toLowerCase()
        codeToResolve = codeToResolve.toLowerCase()
        if (isCreation) { // constructor
          codeToResolve = '0x' + RLP.decode(codeToResolve)[0].toString('hex')
        }
        // console.log('- codeToResolve: ', codeToResolve)
        // console.log('- bytes: ', bytes)
      } else {
        bytes = isCreation ? contract.object.evm.bytecode.object : contract.object.evm.deployedBytecode.object
      }
      if (codeUtil.compareByteCode(codeToResolve, '0x' + bytes)) {
        found = contract.name
        // console.log('* found: ', found)
        return true
      }
    })
    // console.log('* found: ', found)
    return found
  }

  _decodeInputParams (data, abi) {
    data = ethJSUtil.toBuffer('0x' + data)
    if (!data.length) data = new Uint8Array(32 * abi.inputs.length) // ensuring the data is at least filled by 0 cause `AbiCoder` throws if there's not engouh data

    var inputTypes = []
    for (var i = 0; i < abi.inputs.length; i++) {
      var type = abi.inputs[i].type
      inputTypes.push(type === 'tuple' ? txHelper.makeFullTupleTypeDefinition(abi.inputs[i]) : type)
    }
    var abiCoder = new ethers.utils.AbiCoder()
    var decoded = abiCoder.decode(inputTypes, data)
    var ret = {}
    for (var k in abi.inputs) {
      ret[abi.inputs[k].type + ' ' + abi.inputs[k].name] = decoded[k]
    }
    return ret
  }
}

// those function will be duplicate after the merged of the compile and run tabs split
function getConstructorInterface (abi) {
  var funABI = { 'name': '', 'inputs': [], 'type': 'constructor', 'outputs': [] }
  for (var i = 0; i < abi.length; i++) {
    if (abi[i].type === 'constructor') {
      funABI.inputs = abi[i].inputs || []
      break
    }
  }

  return funABI
}

function getFunction (abi, fnName) {
  fnName = fnName.split('(')[0]
  for (var i = 0; i < abi.length; i++) {
    if (abi[i].name === fnName) {
      return abi[i]
    }
  }
  return null
}

/**
 * @rv
 * @param {object[]} ieleAbi - iele abi
 * @param {string} fnName - iele function name
 */
function getFunctionForIELE(ieleAbi, fnName) {
  for (var i = 0; i < ieleAbi.length; i++) {
    if (ieleAbi[i].name === fnName) {
      return ieleAbi[i]
    }
  }
  return null
}

/**
 * @rv
 * @param {object[]} solidityAbi - solidity abi
 * @param {string} fnName - iele function name
 */
function getFunctionForSolidity(solidityAbi, fnName) {
  for (let i = 0; i < solidityAbi.length; i++) {
    if (ieleTranslator.encodeSolidityFunctionName(solidityAbi[i]) === fnName) {
      return solidityAbi[i]
    }
  }
  return null
}

module.exports = TxListener
