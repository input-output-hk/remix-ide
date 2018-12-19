'use strict'
var EthJSTX = require('ethereumjs-tx')
var EthJSBlock = require('ethereumjs-block')
var ethJSUtil = require('ethereumjs-util')
var BN = ethJSUtil.BN
var executionContext = require('./execution-context')
var EventManager = require('../eventManager')

// window['EthJSTX'] = EthJSTX
// window['BN'] = ethJSUtil.BN

function TxRunner (vmaccounts, api) {
  this.event = new EventManager()
  this._api = api
  this.blockNumber = 0
  this.runAsync = true
  if (executionContext.isVM()) {
    this.blockNumber = 1150000 // The VM is running in Homestead mode, which started at this block.
    this.runAsync = false // We have to run like this cause the VM Event Manager does not support running multiple txs at the same time.
  }
  this.pendingTxs = {}
  this.vmaccounts = vmaccounts
  this.queusTxs = []
}

TxRunner.prototype.rawRun = function (args, confirmationCb, gasEstimationForceSend, promptCb, cb) {
  run(this, args, Date.now(), confirmationCb, gasEstimationForceSend, promptCb, cb)
}

TxRunner.prototype._executeTx = function (tx, gasPrice, chainId, privateKey, api, promptCb, callback) {
  // console.log('@txRunner.js TxRunner.prototype._executeTx')
  // console.log('* tx: ',tx)
  // console.log('* gasPrice: ', gasPrice)
  // console.log('* chainId: ', chainId)
  // console.log('                              personalMode: ', api.personalMode())
  if (gasPrice) tx.gasPrice = executionContext.web3().toHex(gasPrice)
  if (api.personalMode()) {
    promptCb(
      (value) => {
        this._sendTransaction(executionContext.web3().personal.sendTransaction, tx, value, chainId, privateKey, callback)
      },
      () => {
        return callback('Canceled by user.')
      }
    )
  } else {
    this._sendTransaction(executionContext.web3().eth.sendTransaction, tx, null, chainId, privateKey, callback)
  }
}

TxRunner.prototype._sendTransaction = function (sendTx, tx, pass, chainId, privateKey, callback) {
  var self = this
  var cb = function (err, resp) {
    if (err) {
      return callback(err, resp)
    }
    self.event.trigger('transactionBroadcasted', [resp])
    tryTillResponse(resp, callback)
  }
  var args = pass !== null ? [tx, pass, cb] : [tx, cb]
  try {
    // console.log('@TxRunner.prototype._sendTransaction', args)
    // console.log(sendTx)
    // @rv: kevm testnet
    if (executionContext.isCustomRPC()) {
      privateKey = Buffer.from(privateKey, 'hex') // convert to Buffer
      const nonce = executionContext.web3().eth.getTransactionCount(tx.from, 'latest')
      // console.log('@txRunner.js TxRunner.prototype._sendTransaction')
      // console.log('* nonce: ', nonce)
      // console.log('* gas: ', tx.gas)
      // console.log('* gasPrice: ', parseInt(tx.gasPrice))
      // console.log('* value: ', tx.value)
      // console.log('* chainId: ', chainId)
      // console.log('* data: ', tx.data)
      // console.log('* p: ', privateKey.toString('hex'))
      // console.log('enter here 1')
      const newTx = { // @rv: BigNumber.js hex string has bug
        nonce: new BN(nonce.toString(10)),
        gasPrice: new BN((parseInt(tx.gasPrice) || 5000000000).toString(10)), // default: 5 gwei
        gasLimit: new BN((tx.gas || 3000000).toString(10)),
        to: tx.to,
        value: new BN(parseInt(tx.value).toString(10) || '0'),
        data: new Buffer(tx.data.slice(2), 'hex'),
        chainId: 0
        // chainId: 0x3d  // <= this will give me error.
      }
      if (chainId) {
        newTx.chainId = parseInt(chainId)
      }
      const ethTx = new EthJSTX(newTx)
      ethTx.sign(privateKey)
      const serializedTx = ethTx.serialize()
      args = ['0x' + serializedTx.toString('hex'), cb]
      sendTx = executionContext.web3().eth.sendRawTransaction
    }
    sendTx.apply({}, args)
  } catch (e) {
    return callback(`Send transaction failed: ${e.message} . if you use an injected provider, please check it is properly unlocked. `)
  }
}

TxRunner.prototype.execute = function (args, confirmationCb, gasEstimationForceSend, promptCb, callback) {
  var self = this

  var data = args.data
  if (data.slice(0, 2) !== '0x') {
    data = '0x' + data
  }

  if (!executionContext.isVM()) {
    self.runInNode(args.from, args.to, data, args.value, args.gasLimit, args.useCall, args.chainId, args.privateKey, confirmationCb, gasEstimationForceSend, promptCb, callback)
  } else {
    try {
      self.runInVm(args.from, args.to, data, args.value, args.gasLimit, args.useCall, callback)
    } catch (e) {
      callback(e, null)
    }
  }
}

TxRunner.prototype.runInVm = function (from, to, data, value, gasLimit, useCall, callback) {
  const self = this
  var account = self.vmaccounts[from]
  if (!account) {
    return callback('Invalid account selected')
  }
  var tx = new EthJSTX({
    nonce: new BN(account.nonce++),
    gasPrice: new BN(1),
    gasLimit: new BN(gasLimit, 10),
    to: to,
    value: new BN(value, 10),
    data: new Buffer(data.slice(2), 'hex')
  })
  tx.sign(account.privateKey)

  const coinbases = [ '0x0e9281e9c6a0808672eaba6bd1220e144c9bb07a', '0x8945a1288dc78a6d8952a92c77aee6730b414778', '0x94d76e24f818426ae84aa404140e8d5f60e10e7e' ]
  const difficulties = [ new BN('69762765929000', 10), new BN('70762765929000', 10), new BN('71762765929000', 10) ]
  var block = new EthJSBlock({
    header: {
      timestamp: new Date().getTime() / 1000 | 0,
      number: self.blockNumber,
      coinbase: coinbases[self.blockNumber % coinbases.length],
      difficulty: difficulties[self.blockNumber % difficulties.length],
      gasLimit: new BN(gasLimit, 10).imuln(2)
    },
    transactions: [],
    uncleHeaders: []
  })
  if (!useCall) {
    ++self.blockNumber
  } else {
    executionContext.vm().stateManager.checkpoint(function () {})
  }

  executionContext.vm().runTx({block: block, tx: tx, skipBalance: true, skipNonce: true}, function (err, result) {
    if (useCall) {
      executionContext.vm().stateManager.revert(function () {})
    }
    err = err ? err.message : err
    if (result) {
      result.status = '0x' + result.vm.exception.toString(16)
    }
    callback(err, {
      result: result,
      transactionHash: ethJSUtil.bufferToHex(new Buffer(tx.hash()))
    })
  })
}

TxRunner.prototype.runInNode = function (from, to, data, value, gasLimit, useCall, chainId, privateKey, confirmCb, gasEstimationForceSend, promptCb, callback) {
  const self = this
  var tx = { from: from, to: to, data: data, value: value }

  // console.log('@txRunner.js TxRunner.prototype.runInNode')
  // console.log('* tx: ', tx)
  // console.log('* gasLimit: ', gasLimit)
  // console.log('* useCall: ', useCall)
  // console.log('* chainId: ', chainId)
  if (useCall) {
    tx.gas = gasLimit
    return executionContext.web3().eth.call(tx, function (error, result) {
      callback(error, {
        result: result,
        transactionHash: result.transactionHash
      })
    })
  }
  executionContext.web3().eth.estimateGas(tx, function (err, gasEstimation) {
    gasEstimationForceSend(err, () => {
      // console.log('- gasEstimation: ', gasEstimation)
      // callback is called whenever no error
      tx.gas = !gasEstimation ? gasLimit : gasEstimation

      // console.log('@executionContext.web3().eth.estimateGas: ', tx.gas);

      if (self._api.config.getUnpersistedProperty('doNotShowTransactionConfirmationAgain')) {
        return self._executeTx(tx, null, chainId, privateKey, self._api, promptCb, callback)
      }

      self._api.detectNetwork((err, network) => {
        if (err) {
          console.log(err)
          return
        }

        confirmCb(network, tx, tx.gas, (gasPrice) => {
          return self._executeTx(tx, gasPrice, chainId, privateKey, self._api, promptCb, callback)
        }, (error) => {
          callback(error)
        })
      })
    }, () => {
      var blockGasLimit = executionContext.currentblockGasLimit()
      // NOTE: estimateGas very likely will return a large limit if execution of the code failed
      //       we want to be able to run the code in order to debug and find the cause for the failure
      if (err) return callback(err)

      var warnEstimation = ' An important gas estimation might also be the sign of a problem in the contract code. Please check loops and be sure you did not sent value to a non payable function (that\'s also the reason of strong gas estimation). '
      warnEstimation += ' ' + err

      if (gasEstimation > gasLimit) {
        return callback('Gas required exceeds limit: ' + gasLimit + '. ' + warnEstimation)
      }
      if (gasEstimation > blockGasLimit) {
        return callback('Gas required exceeds block gas limit: ' + gasLimit + '. ' + warnEstimation)
      }
    })
  })
}

function tryTillResponse (txhash, done) {
  executionContext.web3().eth.getTransactionReceipt(txhash, function (err, result) {
    if (err || !result) {
      // Try again with a bit of delay if error or if result still null
      setTimeout(function () { tryTillResponse(txhash, done) }, 500)
    } else {
      done(err, {
        result: result,
        transactionHash: result.transactionHash
      })
    }
  })
}

function run (self, tx, stamp, confirmationCb, gasEstimationForceSend, promptCb, callback) {
  if (!self.runAsync && Object.keys(self.pendingTxs).length) {
    self.queusTxs.push({ tx, stamp, callback })
  } else {
    self.pendingTxs[stamp] = tx
    self.execute(tx, confirmationCb, gasEstimationForceSend, promptCb, (error, result) => {
      delete self.pendingTxs[stamp]
      callback(error, result)
      if (self.queusTxs.length) {
        var next = self.queusTxs.pop()
        run(self, next.tx, next.stamp, next.callback)
      }
    })
  }
}

module.exports = TxRunner
