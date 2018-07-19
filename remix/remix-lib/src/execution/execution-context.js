'use strict'
var Web3 = require('web3')
var EventManager = require('../eventManager')
var EthJSVM = require('ethereumjs-vm')
var ethUtil = require('ethereumjs-util')
var StateManager = require('ethereumjs-vm/dist/stateManager')
var Web3VMProvider = require('../web3Provider/web3VmProvider')

var rlp = ethUtil.rlp

var injectedProvider

var web3
if (typeof window !== 'undefined' && typeof window.web3 !== 'undefined') {
  injectedProvider = window.web3.currentProvider
  web3 = new Web3(injectedProvider)
} else {
  web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:8545'))
}

var blankWeb3 = new Web3()

/*
  extend vm state manager and instanciate VM
*/

class StateManagerCommonStorageDump extends StateManager {
  constructor (arg) {
    super(arg)
    this.keyHashes = {}
  }

  putContractStorage (address, key, value, cb) {
    this.keyHashes[ethUtil.sha3(key).toString('hex')] = ethUtil.bufferToHex(key)
    super.putContractStorage(address, key, value, cb)
  }

  dumpStorage (address, cb) {
    var self = this
    this._getStorageTrie(address, function (err, trie) {
      if (err) {
        return cb(err)
      }
      var storage = {}
      var stream = trie.createReadStream()
      stream.on('data', function (val) {
        var value = rlp.decode(val.value)
        storage['0x' + val.key.toString('hex')] = {
          key: self.keyHashes[val.key.toString('hex')],
          value: '0x' + value.toString('hex')
        }
      })
      stream.on('end', function () {
        cb(storage)
      })
    })
  }
}

var stateManager = new StateManagerCommonStorageDump({})
var vm = new EthJSVM({
  enableHomestead: true,
  activatePrecompiles: true
})

// FIXME: move state manager in EthJSVM ctr
vm.stateManager = stateManager
vm.blockchain = stateManager.blockchain
vm.trie = stateManager.trie
vm.stateManager.checkpoint()

var web3VM = new Web3VMProvider()
web3VM.setVM(vm)

var mainNetGenesisHash = '0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3'

/*
  trigger contextChanged, web3EndpointChanged
*/
function ExecutionContext () {
  var self = this
  this.event = new EventManager()

  var executionContext = null

  this.blockGasLimitDefault = 4300000
  this.blockGasLimit = this.blockGasLimitDefault

  this.init = function (config) {
    this.config = config // @rv: save config to this object scope
    if (config.get('settings/always-use-vm')) {
      executionContext = 'vm'
    } else if (config.get('history/execution-context')) {
      executionContext = config.get('history/execution-context')
    } else {
      executionContext = injectedProvider ? 'injected' : 'vm'
    }
  }

  // @rv: save password for address temporarily
  var addressPasswordMap = {}
  this.saveAddressAndPassword = function(address, password) {
    address = address.replace(/^0x/, '')
    addressPasswordMap[address] = password
  }
  this.getPasswordFromAddress = function(address) {
    address = address.replace(/^0x/, '')
    return addressPasswordMap[address]
  }

  this.getProvider = function () {
    return executionContext
  }

  this.isVM = function () {
    return executionContext === 'vm'
  }

  /**
   * @rv: Check if the current context is of type custom RPC
   */
  this.isCustomRPC = function() {
    return executionContext && executionContext.startsWith('custom-rpc-')
  }

  this.web3 = function () {
    return this.isVM() ? web3VM : web3
  }

  this.isIeleVM = function() { // TODO: @rv: use new endpoint to check if the node is using iele vm
    const customRPCList = this.config.get('custom-rpc-list') || []
    const customRPC = customRPCList.filter((x)=> x.context === executionContext)[0]
    if (customRPC) {
      return customRPC.vm === 'ielevm'
    } else {
      return false
    }
  }

  this.detectNetwork = function (callback) {
    if (this.isVM()) {
      callback(null, { id: '-', name: 'VM' })
    } else {
      this.web3().version.getNetwork((err, id) => {
        var name = null
        if (err) name = 'Unknown'
        // https://github.com/ethereum/EIPs/blob/master/EIPS/eip-155.md
        else if (id === '1') name = 'Main'
        else if (id === '2') name = 'Morden (deprecated)'
        else if (id === '3') name = 'Ropsten'
        else if (id === '4') name = 'Rinkeby'
        else if (id === '42') name = 'Kovan'
        else if (id === '13137357' || id === '1234') name = 'Goguen' // @rv: add Goguen
        else name = 'Custom'

        if (id === '1') {
          this.web3().eth.getBlock(0, (error, block) => {
            if (error) console.log('cant query first block')
            if (block && block.hash !== mainNetGenesisHash) name = 'Custom'
            callback(err, { id, name })
          })
        } else {
          callback(err, { id, name })
        }
      })
    }
  }

  this.internalWeb3 = function () {
    return web3
  }

  this.blankWeb3 = function () {
    return blankWeb3
  }

  this.vm = function () {
    return vm
  }

  this.setContext = function (context, endPointUrl, confirmCb, infoCb, cb) {
    executionContext = context
    this.executionContextChange(context, endPointUrl, confirmCb, infoCb, cb)
  }

  this.executionContextChange = function (context, endPointUrl, confirmCb, infoCb, cb) {
    if (!cb) cb = () => {}

    // @rv: save context to history
    this.config.set('history/execution-context', context)

    if (context === 'vm') {
      executionContext = context
      vm.stateManager.revert(function () {
        vm.stateManager.checkpoint()
      })
      self.event.trigger('contextChanged', ['vm'])
      return cb()
    } else if (context === 'injected') {
      if (injectedProvider === undefined) {
        var alertMsg = 'No injected Web3 provider found. '
        alertMsg += 'Make sure your provider (e.g. MetaMask) is active and running '
        alertMsg += '(when recently activated you may have to reload the page).'
        infoCb(alertMsg)
        return cb()
      } else {
        executionContext = context
        web3.setProvider(injectedProvider)
        self._updateBlockGasLimit()
        self.event.trigger('contextChanged', ['injected'])
        return cb()
      }
    } else if (context === 'web3') {
      confirmCb(cb)
    } else if (context.startsWith('custom-rpc-')) { // @rv: connect to Custom RPC
      executionContext = context
      web3.setProvider(new web3.providers.HttpProvider(endPointUrl))
      self.event.trigger('contextChanged', [context])
      return cb()
    }
  }

  this.currentblockGasLimit = function () {
    return this.blockGasLimit
  }

  this.stopListenOnLastBlock = function () {
    if (this.listenOnLastBlockId) clearInterval(this.listenOnLastBlockId)
    this.listenOnLastBlockId = null
  }

  this._updateBlockGasLimit = function () {
    if (this.getProvider() !== 'vm') {
      web3.eth.getBlock('latest', (err, block) => {
        if (!err) {
          // we can't use the blockGasLimit cause the next blocks could have a lower limit : https://github.com/ethereum/remix/issues/506
          this.blockGasLimit = (block && block.gasLimit) ? Math.floor(block.gasLimit - (5 * block.gasLimit) / 1024) : this.blockGasLimitDefault
        } else {
          this.blockGasLimit = this.blockGasLimitDefault
        }
      })
    }
  }

  this.listenOnLastBlock = function () {
    this.listenOnLastBlockId = setInterval(() => {
      this._updateBlockGasLimit()
    }, 15000)
  }

  // TODO: not used here anymore and needs to be moved
  function setProviderFromEndpoint (endpoint, context, cb) {
    var oldProvider = web3.currentProvider

    if (endpoint === 'ipc') {
      web3.setProvider(new web3.providers.IpcProvider())
    } else {
      web3.setProvider(new web3.providers.HttpProvider(endpoint))
    }
    if (web3.isConnected()) {
      executionContext = context
      self._updateBlockGasLimit()
      self.event.trigger('contextChanged', ['web3'])
      self.event.trigger('web3EndpointChanged')
      cb()
    } else {
      web3.setProvider(oldProvider)
      var alertMsg = 'Not possible to connect to the Web3 provider. '
      alertMsg += 'Make sure the provider is running and a connection is open (via IPC or RPC).'
      cb(alertMsg)
    }
  }
  this.setProviderFromEndpoint = setProviderFromEndpoint

  this.txDetailsLink = function (network, id, hash) {
    if (transactionDetailsLinks[network]) {
      return transactionDetailsLinks[network] + hash
    } else if (transactionDetailsLinksRV[id]) {
      return transactionDetailsLinksRV[id] + hash
    }
  }
}

var transactionDetailsLinks = {
  'Main': 'https://www.etherscan.io/tx/',
  'Rinkeby': 'https://rinkeby.etherscan.io/tx/',
  'Ropsten': 'https://ropsten.etherscan.io/tx/',
  'Kovan': 'https://kovan.etherscan.io/tx/',
}

var transactionDetailsLinksRV = {
  '13137357': 'https://kevm-testnet.iohkdev.io/transaction/',
  '1234': 'https://staging.iele.dev-mantis.iohkdev.io/transaction/'
}

module.exports = new ExecutionContext()
