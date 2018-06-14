/* global */
'use strict'

var yo = require('yo-yo')
var async = require('async')
var ethJSUtil = require('ethereumjs-util')
var BN = ethJSUtil.BN
var remixLib = require('remix-lib')
var EventManager = remixLib.EventManager
var crypto = require('crypto')
var TxRunner = remixLib.execution.txRunner
var txExecution = remixLib.execution.txExecution
var txFormat = remixLib.execution.txFormat
var txHelper = remixLib.execution.txHelper
var executionContext = require('./execution-context')
var modalCustom = require('./app/ui/modal-dialog-custom')
var uiUtil = require('./app/ui/util')

var modalDialog = require('./app/ui/modaldialog')
var typeConversion = remixLib.execution.typeConversion
var confirmDialog = require('./app/execution/confirmDialog')

var keythereum = require("keythereum")

/*
  trigger debugRequested
*/
function UniversalDApp (opts = {}) {
  this.event = new EventManager()
  var self = this

  self._api = opts.api
  self.removable = opts.opt.removable
  self.removable_instances = opts.opt.removable_instances
  executionContext.event.register('contextChanged', this, function (context) {
    self.reset(self.contracts)
  })
  self.txRunner = new TxRunner({}, opts.api)
}

UniversalDApp.prototype.reset = function (contracts, transactionContextAPI) {
  this.contracts = contracts
  if (transactionContextAPI) {
    this.transactionContextAPI = transactionContextAPI
  }
  this.accounts = {}
  if (executionContext.isVM()) {
    this._addAccount('3cd7232cd6f3fc66a57a6bedc1a8ed6c228fff0a327e169c2bcc5e869ed49511', '0x56BC75E2D63100000')
    this._addAccount('2ac6c190b09897cd8987869cc7b918cfea07ee82038d492abce033c75c1b1d0c', '0x56BC75E2D63100000')
    this._addAccount('dae9801649ba2d95a21e688b56f77905e5667c44ce868ec83f82e838712a2c7a', '0x56BC75E2D63100000')
    this._addAccount('d74aa6d18aa79a05f3473dd030a97d3305737cbc8337d940344345c1f6b72eea', '0x56BC75E2D63100000')
    this._addAccount('71975fbf7fe448e004ac7ae54cad0a383c3906055a65468714156a07385e96ce', '0x56BC75E2D63100000')
    executionContext.vm().stateManager.cache.flush(function () {})
  }
  this.txRunner = new TxRunner(this.accounts, this._api)
  this.txRunner.event.register('transactionBroadcasted', (txhash) => {
    this._api.detectNetwork((error, network) => {
      if (!error && network) {
        var txLink = executionContext.txDetailsLink(network.name, txhash)
        if (txLink) this._api.logHtmlMessage(yo`<a href="${txLink}" target="_blank">${txLink}</a>`)
      }
    })
  })
}

UniversalDApp.prototype.newAccount = function (password, cb) {
  if (executionContext.isCustomRPC()) { // @rv: account creation for testnet
    modalCustom.promptPassphraseCreation((error, password) => {
      if (error) {
        modalCustom.alert(error)
      } else {
        const dk = keythereum.create()
        const keystore = keythereum.dump(password, dk.privateKey, dk.salt, dk.iv)

        // save address and password to executionContext for temporary use
        executionContext.saveAddressAndPassword(keystore.address, password)
        // save keystore to `rv-accounts`
        const accounts = this._api.config.get('rv-accounts') || []
        accounts.push(keystore)
        this._api.config.set('rv-accounts', accounts)
        return cb(null, '0x' + keystore.address)
      }
    })
  } else if (!executionContext.isVM()) {
    if (!this._api.personalMode()) {
      return cb('Not running in personal mode')
    }
    modalCustom.promptPassphraseCreation((error, passphrase) => {
      if (error) {
        modalCustom.alert(error)
      } else {
        executionContext.web3().personal.newAccount(passphrase, cb)
      }
    }, () => {})
  } else {
    var privateKey
    do {
      privateKey = crypto.randomBytes(32)
    } while (!ethJSUtil.isValidPrivate(privateKey))
    this._addAccount(privateKey, '0x56BC75E2D63100000')
    cb(null, '0x' + ethJSUtil.privateToAddress(privateKey).toString('hex'))
  }
}

UniversalDApp.prototype._addAccount = function (privateKey, balance) {
  var self = this

  if (!executionContext.isVM()) {
    throw new Error('_addAccount() cannot be called in non-VM mode')
  }

  if (self.accounts) {
    privateKey = new Buffer(privateKey, 'hex')
    var address = ethJSUtil.privateToAddress(privateKey)

    // FIXME: we don't care about the callback, but we should still make this proper
    executionContext.vm().stateManager.putAccountBalance(address, balance || '0xf00000000000000001', function cb () {})
    self.accounts['0x' + address.toString('hex')] = { privateKey: privateKey, nonce: 0 }
  }
}

UniversalDApp.prototype.getAccounts = function (cb) {
  var self = this

  if (!executionContext.isVM()) {
    // Weirdness of web3: listAccounts() is sync, `getListAccounts()` is async
    // See: https://github.com/ethereum/web3.js/issues/442
    if (this._api.personalMode()) {
      executionContext.web3().personal.getListAccounts(cb)
    } else if (executionContext.isCustomRPC()) { // @rv: kevm testnet, load accounts from `rv-accounts`
      const keystores = this._api.config.get('rv-accounts') || []
      const accounts = keystores.map((x)=> '0x' + x.address).filter(x=>x)
      cb(null, accounts)
    } else {
      executionContext.web3().eth.getAccounts(cb)
    }
  } else {
    if (!self.accounts) {
      return cb('No accounts?')
    }

    cb(null, Object.keys(self.accounts))
  }
}

UniversalDApp.prototype.getBalance = function (address, cb) {
  var self = this

  address = ethJSUtil.stripHexPrefix(address)

  if (!executionContext.isVM()) {
    executionContext.web3().eth.getBalance(address, function (err, res) {
      if (err) {
        cb(err)
      } else {
        cb(null, res.toString(10))
      }
    })
  } else {
    if (!self.accounts) {
      return cb('No accounts?')
    }

    executionContext.vm().stateManager.getAccountBalance(new Buffer(address, 'hex'), function (err, res) {
      if (err) {
        cb('Account not found')
      } else {
        cb(null, new BN(res).toString(10))
      }
    })
  }
}

UniversalDApp.prototype.pendingTransactions = function () {
  return this.txRunner.pendingTxs
}

UniversalDApp.prototype.call = function (isUserAction, args, value, lookupOnly, outputCb) {
  const self = this
  var logMsg
  if (isUserAction) {
    if (!args.funABI.constant) {
      logMsg = `transact to ${args.contractName}.${(args.funABI.name) ? args.funABI.name : '(fallback)'}`
    } else {
      logMsg = `call to ${args.contractName}.${(args.funABI.name) ? args.funABI.name : '(fallback)'}`
    }
  }
  txFormat.buildData(args.contractName, args.contractAbi, self.contracts, false, args.funABI, value, (error, data) => {
    if (!error) {
      if (isUserAction) {
        if (!args.funABI.constant) {
          self._api.logMessage(`${logMsg} pending ... `)
        } else {
          self._api.logMessage(`${logMsg}`)
        }
      }
      self.callFunction(args.address, data, args.funABI, (error, txResult) => {
        if (!error) {
          var isVM = executionContext.isVM()
          if (isVM) {
            var vmError = txExecution.checkVMError(txResult)
            if (vmError.error) {
              self._api.logMessage(`${logMsg} errored: ${vmError.message} `)
              return
            }
          }
          if (lookupOnly) {
            var decoded = uiUtil.decodeResponseToTreeView(executionContext.isVM() ? txResult.result.vm.return : ethJSUtil.toBuffer(txResult.result), args.funABI)
            outputCb(decoded)
          }
        } else {
          self._api.logMessage(`${logMsg} errored: ${error} `)
        }
      })
    } else {
      self._api.logMessage(`${logMsg} errored: ${error} `)
    }
  }, (msg) => {
    self._api.logMessage(msg)
  }, (data, runTxCallback) => {
    // called for libraries deployment
    self.runTx(data, runTxCallback)
  })
}

/**
  * deploy the given contract
  *
  * @param {String} data    - data to send with the transaction ( return of txFormat.buildData(...) ).
  * @param {Function} callback    - callback.
  */
UniversalDApp.prototype.createContract = function (data, callback) {
  this.runTx({data: data, useCall: false}, (error, txResult) => {
    // see universaldapp.js line 660 => 700 to check possible values of txResult (error case)
    callback(error, txResult)
  })
}

/**
  * call the current given contract
  *
  * @param {String} to    - address of the contract to call.
  * @param {String} data    - data to send with the transaction ( return of txFormat.buildData(...) ).
  * @param {Object} funAbi    - abi definition of the function to call.
  * @param {Function} callback    - callback.
  */
UniversalDApp.prototype.callFunction = function (to, data, funAbi, callback) {
  this.runTx({to: to, data: data, useCall: funAbi.constant}, (error, txResult) => {
    // see universaldapp.js line 660 => 700 to check possible values of txResult (error case)
    callback(error, txResult)
  })
}

UniversalDApp.prototype.context = function () {
  return (executionContext.isVM() ? 'memory' : 'blockchain')
}

UniversalDApp.prototype.getABI = function (contract) {
  return txHelper.sortAbiFunction(contract.abi)
}

UniversalDApp.prototype.getFallbackInterface = function (contractABI) {
  return txHelper.getFallbackInterface(contractABI)
}

UniversalDApp.prototype.getInputs = function (funABI) {
  if (!funABI.inputs) {
    return ''
  }
  return txHelper.inputParametersDeclarationToString(funABI.inputs)
}

UniversalDApp.prototype.runTx = function (args, cb) {
  const self = this
  async.waterfall([
    function getGasLimit (next) {
      if (self.transactionContextAPI.getGasLimit) {
        return self.transactionContextAPI.getGasLimit(next)
      }
      next(null, 3000000)
    },
    function queryValue (gasLimit, next) {
      if (args.value) {
        return next(null, args.value, gasLimit)
      }
      if (args.useCall || !self.transactionContextAPI.getValue) {
        return next(null, 0, gasLimit)
      }
      self.transactionContextAPI.getValue(function (err, value) {
        next(err, value, gasLimit)
      })
    },
    function getAccount (value, gasLimit, next) {
      if (args.from) {
        return next(null, args.from, value, gasLimit)
      }
      if (self.transactionContextAPI.getAddress) {
        return self.transactionContextAPI.getAddress(function (err, address) {
          next(err, address, value, gasLimit)
        })
      }
      self.getAccounts(function (err, accounts) {
        let address = accounts[0]

        if (err) return next(err)
        if (!address) return next('No accounts available')
        if (executionContext.isVM() && !self.accounts[address]) {
          return next('Invalid account selected')
        }
        next(null, address, value, gasLimit)
      })
    },
    // @rv: unlock account if necessary
    function unlockAccount (address, value, gasLimit, next) {
      function _getPrivateKey(keystore, password) {
        keythereum.recover(password, keystore, (privateKey)=> {
          if (privateKey.toString('hex').length !== 64) { // Invalid privateKey
            const error = privateKey
            return next(error)
          } else {
            privateKey = privateKey.toString('hex')
            executionContext.saveAddressAndPassword(address, password) // So user doesn't have to unlock again.
            return next(null, address, value, gasLimit, privateKey)
          }
        })
      }

      if (!args.useCall &&   // not a call function
          (executionContext.isCustomRPC())) {
        const accounts = self._api.config.get('rv-accounts')
        const keystore = accounts.filter((x)=> x.address === address.replace(/^0x/, ''))[0]
        if (!keystore) {
          return next('Account ' + address + ' not found')
        }
        const password = executionContext.getPasswordFromAddress(address)
        if (typeof(password) === 'undefined') {
          modalCustom.unlockAccount(address, (error, password)=> {
            if (error) {
              return next(error)
            } else {
              return _getPrivateKey(keystore, password)
            }
          })
        } else {
          return _getPrivateKey(keystore, password)
        }
      } else {
        next(null, address, value, gasLimit, undefined)
      }
    },
    function runTransaction (fromAddress, value, gasLimit, privateKey, next) {
      var tx = { to: args.to, data: args.data.dataHex, useCall: args.useCall, from: fromAddress, value: value, gasLimit: gasLimit, privateKey: privateKey }
      var payLoad = { funAbi: args.data.funAbi, funArgs: args.data.funArgs, contractBytecode: args.data.contractBytecode, contractName: args.data.contractName }
      var timestamp = Date.now()

      // @rv: pass chainId to `tx`
      if (executionContext.isCustomRPC()) {
        const context = executionContext.getProvider()
        const customRPCList = self._api.config.get('custom-rpc-list')
        const customRPC = customRPCList.filter((x)=> x && x.context === context)[0]
        if (customRPC) {
          tx.chainId = customRPC.chainId
        }
      }

      self.event.trigger('initiatingTransaction', [timestamp, tx, payLoad])
      self.txRunner.rawRun(tx,

        (network, tx, gasEstimation, continueTxExecution, cancelCb) => {
          if (network.name !== 'Main' && network.name !== 'Goguen') { // @rv: Let user specify gasPrice
            return continueTxExecution(null)
          }
          var amount = executionContext.web3().fromWei(typeConversion.toInt(tx.value), 'ether')
          var content = confirmDialog(tx, amount, gasEstimation, self,
            (gasPrice, cb) => {
              let txFeeText, priceStatus
              // TODO: this try catch feels like an anti pattern, can/should be
              // removed, but for now keeping the original logic
              try {
                var fee = executionContext.web3().toBigNumber(tx.gas).mul(executionContext.web3().toBigNumber(executionContext.web3().toWei(gasPrice.toString(10), 'gwei')))
                txFeeText = ' ' + executionContext.web3().fromWei(fee.toString(10), 'ether') + ' Ether'
                priceStatus = true
              } catch (e) {
                txFeeText = ' Please fix this issue before sending any transaction. ' + e.message
                priceStatus = false
              }
              cb(txFeeText, priceStatus)
            },
            (cb) => {
              executionContext.web3().eth.getGasPrice((error, gasPrice) => {
                var warnMessage = ' Please fix this issue before sending any transaction. '
                if (error) {
                  return cb('Unable to retrieve the current network gas price.' + warnMessage + error)
                }
                try {
                  var gasPriceValue = executionContext.web3().fromWei(gasPrice.toString(10), 'gwei')
                  cb(null, gasPriceValue)
                } catch (e) {
                  cb(warnMessage + e.message, null, false)
                }
              })
            }
          )
          modalDialog('Confirm transaction', content,
            { label: 'Confirm',
              fn: () => {
                self._api.config.setUnpersistedProperty('doNotShowTransactionConfirmationAgain', content.querySelector('input#confirmsetting').checked)
                // TODO: check if this is check is still valid given the refactor
                if (!content.gasPriceStatus) {
                  cancelCb('Given gas price is not correct')
                } else {
                  var gasPrice = executionContext.web3().toWei(content.querySelector('#gasprice').value, 'gwei')
                  continueTxExecution(gasPrice)
                }
              }}, {
                label: 'Cancel',
                fn: () => {
                  return cancelCb('Transaction canceled by user.')
                }
              })
        },
        (error, continueTxExecution, cancelCb) => {
          if (error) {
            var msg = typeof error !== 'string' ? error.message : error
            modalDialog('Gas estimation failed', yo`<div>Gas estimation errored with the following message (see below).
            The transaction execution will likely fail. Do you want to force sending? <br>
            ${msg}
            </div>`,
              {
                label: 'Send Transaction',
                fn: () => {
                  continueTxExecution()
                }}, {
                  label: 'Cancel Transaction',
                  fn: () => {
                    cancelCb()
                  }
                })
          } else {
            continueTxExecution()
          }
        },
        function (okCb, cancelCb) {
          modalCustom.promptPassphrase(null, 'Personal mode is enabled. Please provide passphrase of account ' + tx.from, '', okCb, cancelCb)
        },
        function (error, result) {
          let eventName = (tx.useCall ? 'callExecuted' : 'transactionExecuted')
          self.event.trigger(eventName, [error, tx.from, tx.to, tx.data, tx.useCall, result, timestamp, payLoad])

          if (error && (typeof (error) !== 'string')) {
            if (error.message) error = error.message
            else {
              try { error = 'error: ' + JSON.stringify(error) } catch (e) {}
            }
          }
          next(error, result)
        }
      )
    }
  ], cb)
}

/**
 * @rv: remove account
 * @param {string} address 
 * @param {(error)=>void} cb 
 */
UniversalDApp.prototype.removeAccount = function(address, cb) {
  const accounts = this._api.config.get('rv-accounts') || []
  this._api.config.set('rv-accounts', accounts.filter((x)=> typeof(x) === 'object' && x.address !== address.replace(/^0x/, ''))) // remove address from accounts
  return cb(null)
}

/**
 * @rv: Export private key
 * @param {string} address 
 * @param {(error:string)=>void} cb 
 */
UniversalDApp.prototype.exportPrivateKey = function(address, cb) {
  const _export = (password)=> {
    const accounts = this._api.config.get('rv-accounts')
    const keystore = accounts.filter((x)=> x.address === address.replace(/^0x/, ''))[0]
    if (!keystore) {
      return cb('Keystore not found', null)
    } else {
      const crypto = keystore.crypto
      try {
        keythereum.recover(password, keystore, (privateKey)=> { // TODO: I think I should submit a pull request to `keythereum`. The design of this callback function is really bad.
          if (privateKey.toString('hex').length !== 64) { // Invalid privateKey
            const error = privateKey
            return cb(error)
          }
          privateKey = privateKey.toString('hex')  // recover private key
          const element = document.createElement('a');
          element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(privateKey));
          element.setAttribute('download', `privateKey_${address}_${(new Date())}`);      
          element.style.display = 'none';
          document.body.appendChild(element);
          element.click();
          document.body.removeChild(element);
          return cb(false)
        })
      } catch(error) { // Failed to recover private key from the combination of keystore and password
        return cb(error, null)
      }
    }
  }

  // const password = executionContext.getPasswordFromAddress(address)
  // if (typeof(password) === 'undefined') { // needs to unlock account
    modalCustom.unlockAccount(address, (error, password)=> { // force to enter password to unlock the account for export.
      if (error) {
        return cb(error)
      } else {
        return _export(password)
      }
    })
  // } else {
  // return _export(password)
  // }
}

/**
 * @rv: Import account for cardano testnet
 * @param {(error:string)=>void} cb 
 */
UniversalDApp.prototype.importAccount = function(cb) {
  const _saveKeystore = (keystore, password)=> {
    // save address and password to executionContext for temporary use
    executionContext.saveAddressAndPassword(keystore.address, password)
    // save keystore to `rv-accounts`
    const accounts = this._api.config.get('rv-accounts') || []
    let find = false
    for (let i = 0; i < accounts.length; i++) {
      if (accounts[i].address === keystore.address) {
        accounts[i] = keystore
        find = true
        break
      }
    }
    if (!find) {
      accounts.push(keystore)
    }
    this._api.config.set('rv-accounts', accounts)
    return cb(null)
  }

  modalCustom.importAccount((error, {privateKey, password, keystore})=> {
    if (error) {
      return cb(error)
    } else if (privateKey) {
      privateKey = privateKey.replace(/^0x/, '')
      keythereum.create(undefined, (dk)=> {
        keythereum.dump(password, privateKey, dk.salt, dk.iv, undefined, (keystore)=> {
          _saveKeystore(keystore, password)
        })
      })
    } else if (keystore) {
      try {
        keystore = JSON.parse(keystore)
        keythereum.recover(password, keystore, (privateKey)=> { // Check if the password is valid
          if (privateKey.toString('hex').length !== 64) { // Invalid privateKey
            const error = privateKey
            return cb(error)
          } else {
            _saveKeystore(keystore, password)
          }
        })
      } catch(error) {
        return cb(error)
      }
    } else {
      return cb('Internal Error')
    }
  })
}

/**
 * @rv: Add custom RPC information to local storage
 * @param {{rpcUrl:string, chainId:number}} param0 
 */
UniversalDApp.prototype.addCustomRPC = function({rpcUrl, chainId}) {
  rpcUrl = rpcUrl.trim()
  let name = `${rpcUrl} (chainId: ${chainId})`
  let context = `custom-rpc-${name}`
  if (rpcUrl.match(/^https\:\/\/kevm-testnet\.iohkdev\.io:8546/)) { // kevm testnet
    name = 'KEVM Testnet'
    context = `custom-rpc-kevm-testnet`
  }
  const customRPC = {
    rpcUrl,
    chainId,
    name,
    context
  }
  const customRPCs = this._api.config.get('custom-rpc-list') || []
  let find = false 
  for (let i = 0; i < customRPCs.length; i++) {
    if (customRPCs[i] && customRPCs[i].rpcUrl === rpcUrl) {
      find = true
      customRPCs[i] = customRPC
      break
    }
  }
  if (!find) {
    customRPCs.push(customRPC)
  }
  this._api.config.set('custom-rpc-list', customRPCs)
  window['UniversalDAppConfig'] = this._api.config
  return customRPC
}

/**
 * @rv: Connect user to Custom RPC
 * @param {(error:string, customRPC:object)=> void} cb 
 */
UniversalDApp.prototype.connectToCustomRPC = function(cb) {
  modalCustom.connectToCustomRPC((error, {rpcUrl, chainId})=> {
    if (error) {
      return cb(error)
    } else {
      const customRPC = this.addCustomRPC({rpcUrl, chainId})
      return cb(null, customRPC)
    }
  })
}

module.exports = UniversalDApp
