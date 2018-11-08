'use strict'
var $ = require('jquery')
var yo = require('yo-yo')
var remixLib = require('remix-lib')
var ethJSUtil = require('ethereumjs-util')
// var csjs = require('csjs-inject')
var txExecution = remixLib.execution.txExecution
var txFormat = remixLib.execution.txFormat
var txHelper = remixLib.execution.txHelper
var EventManager = remixLib.EventManager
var helper = require('../../lib/helper.js')
var executionContext = require('../../execution-context')
var modalDialogCustom = require('../ui/modal-dialog-custom')
var copyToClipboard = require('../ui/copy-to-clipboard')
// var Card = require('../ui/card')
// var Recorder = require('../../recorder')
var addTooltip = require('../ui/tooltip')
var css = require('./styles/run-tab-styles')
var MultiParamManager = require('../../multiParamManager')

function runTab (appAPI = {}, appEvents = {}, opts = {}) {
  /* -------------------------
            VARIABLES
  --------------------------- */
  var self = this
  var event = new EventManager()
  appEvents.eventManager = event
  self._view = {}
  self.data = {
    count: 0,
    text: `All transactions (deployed contracts and function executions)
    in this environment can be saved and replayed in
    another environment. e.g Transactions created in
    Javascript VM can be replayed in the Injected Web3.`
  }

  self._view.recorderCount = yo`<span>0</span>`
  self._view.instanceContainer = yo`<div class="${css.instanceContainer}"></div>`
  self._view.clearInstanceElement = yo`
    <i class="${css.clearinstance} ${css.icon} fa fa-trash" onclick=${() => clearInstanceList(self)}
    title="Clear instances list and reset recorder" aria-hidden="true">
  </i>`
  self._view.instanceContainerTitle = yo`
    <div class=${css.instanceContainerTitle}
      title="Autogenerated generic user interfaces for interaction with deployed contracts">
      Deployed Contracts
      ${self._view.clearInstanceElement}
    </div>`
  self._view.noInstancesText = yo`
    <div class="${css.noInstancesText}">
      Currently you have no contract instances to interact with.
    </div>`

  var container = yo`<div class="${css.runTabView}" id="runTabView" ></div>`

  // TODO: @rv: recorderInterface is temporarily disabled
  // var recorderInterface = makeRecorder(appAPI, appEvents, opts, self) // @rv: disabled temporarily

  self._view.collapsedView = yo`
    <div class=${css.recorderCollapsedView}>
      <div class=${css.recorderCount}>${self._view.recorderCount}</div>
    </div>`

  self._view.expandedView = yo`
    <div class=${css.recorderExpandedView}>
      <div class=${css.recorderDescription}>
        ${self.data.text}
      </div>
      ${/*
      <div class="${css.transactionActions}">
        ${recorderInterface.recordButton}
        ${recorderInterface.runButton}
        </div>
      </div>
        */''}
    </div>`

  /*
  // @rv: disable recorder
  self.recorderOpts = {
    title: 'Transactions recorded:',
    collapsedView: self._view.collapsedView
  }

  var recorderCard = new Card({}, {}, self.recorderOpts)
  recorderCard.event.register('expandCollapseCard', (arrow, body, status) => {
    body.innerHTML = ''
    status.innerHTML = ''
    if (arrow === 'down') {
      status.appendChild(self._view.collapsedView)
      body.appendChild(self._view.expandedView)
    } else if (arrow === 'up') {
      status.appendChild(self._view.collapsedView)
    }
  })
  */

    /* -------------------------
         MAIN HTML ELEMENT
    --------------------------- */
  var el = yo`
  <div>
    ${settings(container, appAPI, appEvents, opts)}
    ${contractDropdown(event, appAPI, appEvents, opts, self)}
    ${''/* recorderCard.render() // @rv: disabled recorder */} 
    ${self._view.instanceContainer}
  </div>
  `
  container.appendChild(el)

  /* -------------------------
        HELPER FUNCTIONS
  --------------------------- */

  // DROPDOWN
  var selectExEnv = el.querySelector('#selectExEnvOptions')

  function clearInstanceList (self) {
    event.trigger('clearInstance', [])
  }

  function setFinalContext () {
    // @rv: toggle RV elements
    toggleRVElements()
    // set the final context. Cause it is possible that this is not the one we've originaly selected
    const context = executionContext.getProvider()
    selectExEnv.value = context
    fillAccountsList(appAPI, opts, el)
    event.trigger('clearInstance', [])
    // @rv: update environment name
    if (context === 'custom-rpc-iohk-testnet') {
      const customRPC = opts.config.get('custom-rpc-list').filter((x) => x.context === context)[0]
      if (customRPC) {
        const option = selectExEnv.querySelector('option[value="custom-rpc-iohk-testnet"]')
        option.setAttribute('title', customRPC.name)
        option.innerText = customRPC.name
      }
    }
  }

  selectExEnv.addEventListener('change', function (event) {
    let context = selectExEnv.options[selectExEnv.selectedIndex].value

    // @rv: set endPointUrl for Custom RPC
    let endPointUrl = null
    if (context.startsWith('custom-rpc-')) {
      const customRPCList = opts.config.get('custom-rpc-list') || []
      for (let i = 0; i < customRPCList.length; i++) {
        if (customRPCList[i].context === context) {
          endPointUrl = customRPCList[i].rpcUrl
          break
        }
      }
    }

    executionContext.executionContextChange(context, endPointUrl, () => {
      modalDialogCustom.confirm(null, 'Are you sure you want to connect to an ethereum node?', () => {
        modalDialogCustom.prompt(null, 'Web3 Provider Endpoint', 'http://localhost:8545', (target) => {
          executionContext.setProviderFromEndpoint(target, context, (alertMsg) => {
            if (alertMsg) {
              modalDialogCustom.alert(alertMsg)
            }
            setFinalContext()
          })
        }, setFinalContext)
      }, setFinalContext)
    }, (alertMsg) => {
      modalDialogCustom.alert(alertMsg)
    }, setFinalContext)
  })

  selectExEnv.value = executionContext.getProvider()
  executionContext.event.register('contextChanged', (context, silent) => {
    setFinalContext()
  })

  fillAccountsList(appAPI, opts, el)
  setInterval(() => {
    updateAccountBalances(container, appAPI)
  }, 10000)

  event.register('clearInstance', () => {
    var instanceContainer = self._view.instanceContainer
    var instanceContainerTitle = self._view.instanceContainerTitle
    instanceContainer.innerHTML = '' // clear the instances list
    instanceContainer.appendChild(instanceContainerTitle)
    instanceContainer.appendChild(self._view.noInstancesText)
  })

  selectExEnv.dispatchEvent(new window.Event('change')) // @rv;
  return { render () { return container } }
}

function fillAccountsList (appAPI, opts, container) {
  var $txOrigin = $(container.querySelector('#txorigin'))
  $txOrigin.empty()
  opts.udapp.getAccounts((err, accounts) => {
    if (err) { addTooltip(`Cannot get account list: ${err}`) }
    if (accounts && accounts[0]) {
      for (var a in accounts) { $txOrigin.append($('<option />').val(accounts[a]).text(accounts[a])) }
      $txOrigin.val(accounts[0])
    } else {
      $txOrigin.val('unknown')
    }
  })
}

function updateAccountBalances (container, appAPI) {
  var $txOrigin = $(container.querySelector('#txorigin'))
  var accounts = $txOrigin.children('option')
  accounts.each(function (index, value) {
    (function (acc) {
      appAPI.getBalance(accounts[acc].value, function (err, res) {
        if (!err) {
          accounts[acc].innerText = helper.shortenAddress(accounts[acc].value, res)
        }
      })
    })(index)
  })
}

/* ------------------------------------------------
           RECORDER
------------------------------------------------ */
/*
TODO: @rv: this function is temporarily disabled
function makeRecorder (appAPI, appEvents, opts, self) {
  var recorder = new Recorder(opts.compiler, opts.udapp, {
    events: {
      udapp: appEvents.udapp,
      executioncontext: executionContext.event,
      runtab: appEvents.eventManager
    },
    api: appAPI
  })
  recorder.event.register('newTxRecorded', (count) => {
    console.log('@run-tab.js newTxRecorded triggered')
    self.data.count = count
    self._view.recorderCount.innerText = count
  })
  recorder.event.register('cleared', () => {
    self.data.count = 0
    self._view.recorderCount.innerText = 0
  })
  var css2 = csjs`
    .container {}
    .runTxs {}
    .recorder {}
  `

  var runButton = yo`<i class="fa fa-play runtransaction ${css2.runTxs} ${css.icon}"  title="Run Transactions" aria-hidden="true"></i>`
  var recordButton = yo`
    <i class="fa fa-floppy-o savetransaction ${css2.recorder} ${css.icon}"
      onclick=${triggerRecordButton} title="Save Transactions" aria-hidden="true">
    </i>`

  function triggerRecordButton () {
    var txJSON = JSON.stringify(recorder.getAll(), null, 2)
    var path = appAPI.currentPath()
    modalDialogCustom.prompt(null, 'Transactions will be saved in a file under ' + path, 'scenario.json', input => {
      var fileProvider = appAPI.fileProviderOf(path)
      if (fileProvider) {
        var newFile = path + input
        helper.createNonClashingName(newFile, fileProvider, (error, newFile) => {
          if (error) return modalDialogCustom.alert('Failed to create file. ' + newFile + ' ' + error)
          if (!fileProvider.set(newFile, txJSON)) {
            modalDialogCustom.alert('Failed to create file ' + newFile)
          } else {
            appAPI.switchFile(newFile)
          }
        })
      }
    })
  }

  runButton.onclick = () => {
    //
    //@TODO
    //update account address in scenario.json
    //popup if scenario.json not open - "Open a file with transactions you want to replay and click play again"
    //
    var currentFile = opts.config.get('currentFile')
    appAPI.fileProviderOf(currentFile).get(currentFile, (error, json) => {
      if (error) {
        modalDialogCustom.alert('Invalid Scenario File ' + error)
      } else {
        if (currentFile.match('.json$')) {
          try {
            var obj = JSON.parse(json)
            var txArray = obj.transactions || []
            var accounts = obj.accounts || []
            var options = obj.options || {}
            var abis = obj.abis || {}
            var linkReferences = obj.linkReferences || {}
          } catch (e) {
            return modalDialogCustom.alert('Invalid Scenario File, please try again')
          }
          if (txArray.length) {
            var noInstancesText = self._view.noInstancesText
            if (noInstancesText.parentNode) { noInstancesText.parentNode.removeChild(noInstancesText) }
            recorder.run(txArray, accounts, options, abis, linkReferences, opts.udapp, (abi, address, contractName) => {
              self._view.instanceContainer.appendChild(opts.udappUI.renderInstanceFromABI(abi, address, contractName))
            })
          }
        } else {
          modalDialogCustom.alert('A scenario file is required. Please make sure a scenario file is currently displayed in the editor. The file must be of type JSON. Use the "Save Transactions" Button to generate a new Scenario File.')
        }
      }
    })
  }

  return { recordButton, runButton }
} */

/* ------------------------------------------------
    CONTRACT (deploy or access deployed)
------------------------------------------------ */

function contractDropdown (events, appAPI, appEvents, opts, self) {
  var instanceContainer = self._view.instanceContainer
  var instanceContainerTitle = self._view.instanceContainerTitle
  instanceContainer.appendChild(instanceContainerTitle)
  instanceContainer.appendChild(self._view.noInstancesText)
  var compFails = yo`<i title="Contract compilation failed. Please check the compile tab for more information." class="fa fa-times-circle ${css.errorIcon}" ></i>`
  appEvents.compiler.register('compilationFinished', function (success, data, source) {
    // @rv: toggle RV elements
    toggleRVElements()
    getContractNames(success, data)
    if (success) {
      compFails.style.display = 'none'
      document.querySelector(`.${css.contractNames}`).classList.remove(css.contractNamesError)
    } else {
      compFails.style.display = 'block'
      document.querySelector(`.${css.contractNames}`).classList.add(css.contractNamesError)
    }
  })

  var atAddressButtonInput = yo`<input class="${css.input} ataddressinput" placeholder="Load contract from Address" title="atAddress" />`
  var selectContractNames = yo`<select class="${css.contractNames}" disabled></select>`

  function getSelectedContract () {
    var contractName = selectContractNames.children[selectContractNames.selectedIndex].innerHTML
    if (contractName) {
      return {
        name: contractName,
        contract: opts.compiler.getContract(contractName)
      }
    }
    return null
  }
  appAPI.getSelectedContract = getSelectedContract

  var createPanel = yo`<div class="${css.button}"></div>`

  var el = yo`
    <div class="${css.container}">
      <div class="${css.subcontainer}">
        ${selectContractNames} ${compFails}
      </div>
      <div class="${css.buttons}">
        ${createPanel}
        <div class="${css.button}">
          ${atAddressButtonInput}
          <div class="${css.atAddress}" onclick=${function () { loadFromAddress(opts.editor, opts.config) }}>At Address</div>
        </div>
      </div>
    </div>
  `

  function setInputParamsPlaceHolder () {
    createPanel.innerHTML = ''
    if (opts.compiler.getContract && selectContractNames.selectedIndex >= 0 && selectContractNames.children.length > 0) {
      // @rv: support iele bytecode
      const contract = getSelectedContract().contract
      let ctrabi
      if (contract.object.sourceLanguage === 'solidity') { // solidity language
        ctrabi = txHelper.getConstructorInterface(contract.object.abi)
      } else { // iele language
        ctrabi = txHelper.getConstructorInterfaceForIELE(contract.object.abi) // TODO: <= support getIELEConstructorInterface
      }

      var createConstructorInstance = new MultiParamManager(0, ctrabi, (valArray, inputsValues) => {
        createInstance(inputsValues)
      }, txHelper.inputParametersDeclarationToString(ctrabi.inputs), `Deploy (${contract.object.vm.toUpperCase()})`)
      createPanel.appendChild(createConstructorInstance.render())
    } else {
      createPanel.innerHTML = 'No compiled contracts'
    }
  }

  selectContractNames.addEventListener('change', setInputParamsPlaceHolder)

  // DEPLOY INSTANCE
  /**
   * @rv
   * @param {} args
   * @param {{sourceLanguage: string, vm: string, ielevm?:object, evm?:object, abi: object}} contract contract object
   */
  function createInstance (args) {
    const selectedContract = getSelectedContract()

    if (selectedContract.contract.object.vm === 'ielevm') {
      if (selectedContract.contract.object.ielevm.bytecode.object.length === 0) {
        modalDialogCustom.alert('This contract does not implement all functions and thus cannot be created.')
        return
      }
    } else {
      if (selectedContract.contract.object.evm.bytecode.object.length === 0) { // evm
        modalDialogCustom.alert('This contract does not implement all functions and thus cannot be created.')
        return
      }
    }

    let constructor
    if (selectedContract.contract.object.sourceLanguage === 'iele') {
      constructor = txHelper.getConstructorInterfaceForIELE(selectedContract.contract.object.abi)
    } else {
      constructor = txHelper.getConstructorInterface(selectedContract.contract.object.abi)
    }

    txFormat.buildData(selectedContract.name, selectedContract.contract.object, opts.compiler.getContracts(), true, constructor, args, (error, data) => {
      if (!error) {
        appAPI.logMessage(`creation of ${selectedContract.name} pending...`)
        opts.udapp.createContract(data, (error, txResult) => {
          if (error) {
            appAPI.logMessage(`creation of ${selectedContract.name} errored: ` + error)
          } else {
            var isVM = executionContext.isVM()
            if (isVM) {
              var vmError = txExecution.checkVMError(txResult)
              if (vmError.error) {
                appAPI.logMessage(vmError.message)
                return
              }
            }
            if (txResult.result.status === false) { // @rv: status === false (statusCode !== '0x00') means transaction execution failed.
              appAPI.logMessage(`creation of ${selectedContract.name} errored: transaction execution failed`)
              return
            }
            var noInstancesText = self._view.noInstancesText
            if (noInstancesText.parentNode) { noInstancesText.parentNode.removeChild(noInstancesText) }
            var address = isVM ? txResult.result.createdAddress : txResult.result.contractAddress
            instanceContainer.appendChild(opts.udappUI.renderInstance(selectedContract.contract.object, address, selectContractNames.value))
          }
        })
      } else {
        appAPI.logMessage(`creation of ${selectedContract.name} errored: ` + error)
      }
    }, (msg) => {
      appAPI.logMessage(msg)
    }, (data, runTxCallback) => {
      // called for libraries deployment
      // console.log('@librarise deployment: ', data)
      // console.log('@selectedContract: ', selectedContract)

      // @rv: add sourceLanguage and vm information
      data.data.sourceLanguage = selectedContract.contract.object.sourceLanguage
      data.data.vm = selectedContract.contract.object.vm
      opts.udapp.runTx(data, runTxCallback)
    })
  }

  // ACCESS DEPLOYED INSTANCE
  function loadFromAddress (editor, config) {
    var noInstancesText = self._view.noInstancesText
    if (noInstancesText.parentNode) { noInstancesText.parentNode.removeChild(noInstancesText) }
    var contractNames = document.querySelector(`.${css.contractNames.classNames[0]}`)
    var address = atAddressButtonInput.value
    if (!ethJSUtil.isValidAddress(address)) {
      return modalDialogCustom.alert('Invalid address.')
    }
    if (/[a-f]/.test(address) && /[A-F]/.test(address) && !ethJSUtil.isValidChecksumAddress(address)) {
      return modalDialogCustom.alert('Invalid checksum address.')
    }
    // TODO: load contract according to ABI is temporarily disabled
    if (/.(.abi)$/.exec(config.get('currentFile'))) {
      modalDialogCustom.confirm(null, 'Do you really want to interact with ' + address + ' using the current ABI definition ?', () => {
        var abi
        try {
          abi = JSON.parse(editor.currentContent())
        } catch (e) {
          return modalDialogCustom.alert('Failed to parse the current file as JSON ABI.')
        }
        instanceContainer.appendChild(opts.udappUI.renderInstanceFromABI(abi, address, address))
      })
    } else {
      var contract = opts.compiler.getContract(contractNames.children[contractNames.selectedIndex].innerHTML)
      instanceContainer.appendChild(opts.udappUI.renderInstance(contract.object, address, selectContractNames.value))
    }
  }

  // GET NAMES OF ALL THE CONTRACTS
  function getContractNames (success, data) {
    var contractNames = document.querySelector(`.${css.contractNames.classNames[0]}`)
    contractNames.innerHTML = ''
    if (success) {
      selectContractNames.removeAttribute('disabled')
      opts.compiler.visitContracts((contract) => {
        // @rv: check if contract target vm matches the vm that node is running.
        const isIeleVM = (contract.object.vm === 'ielevm')
        if (isIeleVM !== executionContext.isIeleVM()) { return }
        contractNames.appendChild(yo`<option>${contract.name}</option>`)
      })
    } else {
      selectContractNames.setAttribute('disabled', true)
    }
    setInputParamsPlaceHolder()
  }

  return el
}
/* ------------------------------------------------
    section SETTINGS: Environment, Account, Gas, Value
------------------------------------------------ */
function settings (container, appAPI, appEvents, opts) {
  setupPredefinedCustomRPCs()

  // VARIABLES
  var net = yo`<span class=${css.network}></span>`
  const updateNetwork = () => {
    executionContext.detectNetwork((err, { id, name } = {}) => {
      if (err) {
        net.innerHTML = 'can\'t detect network '
      } else {
        net.innerHTML = `<i class="${css.networkItem} fa fa-plug" aria-hidden="true"></i> ${name} (${id || '-'})`
      }
    })
  }
  var environmentEl = yo`
    <div class="${css.crow}">
      <div id="selectExEnv" class="${css.col1_1}">
        Environment
      </div>
      <div class=${css.environment}>
        ${net}
        <select id="selectExEnvOptions" onchange=${updateNetwork} class="${css.select}">
          ${(opts.config.get('custom-rpc-list') || []).map((customRPC) => {
            return yo`<option
              title="${customRPC.name || 'Custom'}"
              value="${customRPC.context}" name="executionContext"
              selected> ${customRPC.name || customRPC.rpcUrl}
            </option>`
          })}
        </select>
        <a href="https://github.com/ethereum/EIPs/blob/master/EIPS/eip-155.md" target="_blank"><i class="${css.icon} fa fa-info"></i></a>
        <i id="remove-custom-rpc-icon" class="${css.icon} fa fa-times" title="Remove selected Custom RPC" style="display:none;" onclick=${removeCustomRPC}></i>
      </div>
    </div>
  `

  var environmentExtraEl = yo`
    <div id="environment-extra-section">
      <div class="${css.crow}">
        <div class="${css.rvButton}" style="margin-left:0;width:164px;display:none;" onclick=${connectToCustomRPC}>Connect to Custom RPC</div>
      </div>
    </div>`

  var accountEl = yo`
    <div class="${css.crow}">
      <div class="${css.col1_1}">Account</div>
      <select name="txorigin" class="${css.select}" id="txorigin"></select>
      ${copyToClipboard(() => document.querySelector('#runTabView #txorigin').value)}
      <i class="fa fa-plus-circle ${css.icon}" aria-hidden="true" onclick=${newAccount} title="Create a new account"></i>
    </div>
  `

  const requestFundsIcon = yo`<i class="fa fa-refresh ${css.requestFundsIcon}" aria-hidden="true"></i>`
  const accountElExtra = yo`
    <div id="account-extra-section">
      <div class="${css.crow}">
        <div class="${css.rvButton}" style="margin-bottom:0;margin-left:0;" onclick=${exportPrivateKey}>Export private key</div>
        <div class="${css.rvButton}" style="margin-bottom:0;" onclick=${removeAccount}>Remove account</div>
        <div class="${css.rvButton}" style="margin-bottom:0;" onclick=${sendCustomTransaction}>Send transaction</div>
      </div>
      <div class="${css.crow}">
        <div class="${css.rvButton}" style="margin-left:0;" onclick=${importAccount}>Import account</div>
        <div class="${css.rvButton}" onclick=${newAccount}>Create account</div>
        <div class="${css.rvButton}" onclick=${requestFromFaucet} id="request-from-faucet-btn">${requestFundsIcon}Get funds</div>
      </div>
    </div>
  `

  var gasPriceEl = yo`
    <div class="${css.crow}">
      <div class="${css.col1_1}">Gas limit</div>
      <input type="number" class="${css.col2}" id="gasLimit" value="3000000">
    </div>
  `
  var valueEl = yo`
    <div class="${css.crow}">
      <div class="${css.col1_1}">Value</div>
      <input type="text" class="${css.col2_1}" id="value" value="0" title="Enter the value and choose the unit">
      <select name="unit" class="${css.col2_2}" id="unit">
        <option data-unit="wei">wei</option>
        <option data-unit="gwei">gwei</option>
        <option data-unit="finney">finney</option>
        <option data-unit="ether">ether</option>
      </select>
    </div>
  `
  // DOM ELEMENT
  var el = yo`
    <div class="${css.settings}">
      ${environmentEl}
      ${environmentExtraEl}
      ${accountEl}
      ${accountElExtra}
      ${gasPriceEl}
      ${valueEl}
    </div>
  `
  // HELPER FUNCTIONS AND EVENTS
  appEvents.udapp.register('transactionExecuted', (error, from, to, data, lookupOnly, txResult) => {
    if (error) return
    if (!lookupOnly) el.querySelector('#value').value = '0'
    updateAccountBalances(container, appAPI)
  })

  setInterval(updateNetwork, 5000)
  function newAccount () {
    appAPI.newAccount('', (error, address) => {
      if (!error) {
        container.querySelector('#txorigin').appendChild(yo`<option value=${address}>${address}</option>`)
        addTooltip(`account ${address} created`)
      } else {
        addTooltip('Cannot create an account: ' + error)
      }
    })
  }

  // @rv: import account
  function importAccount () {
    opts.udapp.importAccount((error) => {
      if (error) {
        addTooltip(`Failed to import account. ` + error)
      } else {
        fillAccountsList(appAPI, opts, document.body)
      }
    })
  }

  // @rv: open faucet website
  function requestFromFaucet () {
    const $txOrigin = $('#txorigin')
    const address = $txOrigin.val()
    if (address === 'unknown' || !address) {
      return addTooltip('No account selected')
    }
    if (requestFundsIcon.classList.contains(css.spinningIcon)) { // requesting funds
      return addTooltip('Your request is being processed')
    }
    const context = executionContext.getProvider()
    let targetUrl = ''
    let txLink = ''
    const customRPC = (opts.config.get('custom-rpc-list') || []).filter((customRPC) => customRPC.context === context)[0]
    if (!customRPC) {
      return addTooltip('No faucet found for ' + context)
    } else {
      targetUrl = customRPC.rpcUrl.replace(/:\d+\/?$/, '').replace(/\/*$/, '') + `:8099/faucet?address=${address}`
      txLink = customRPC.rpcUrl.replace(/:\d+\/?$/, '').replace(/\/*$/, '') + `/transaction/`
    }
    appAPI.logMessage(`request from Faucet pending...`)
    requestFundsIcon.classList.add(css.spinningIcon)
    setTimeout(() => { // Delay the request for a bit.
      window.fetch(targetUrl, {
        method: 'POST',
        cors: true
      }).then((response) => {
        return response.text()
      }).then((receipt) => {
        requestFundsIcon.classList.remove(css.spinningIcon)
        if (!isNaN(receipt)) {
          txLink = `${txLink}${receipt}`
          appAPI.logMessage(`your transaction has been successful and funds have been sent to your wallet`)
          appAPI.logHtmlMessage(yo`<a href="${txLink}" target="_blank">${txLink}</a>`)
          updateAccountBalances(container, appAPI)
        } else {
          throw receipt
        }
      }).catch((error) => {
        requestFundsIcon.classList.remove(css.spinningIcon)
        appAPI.logMessage(`request from Faucet errored: ${error}`)
      })
    }, 1500)
  }

  // @rv: remove account
  function removeAccount () {
    const $txOrigin = $('#txorigin')
    const address = $txOrigin.val()
    if (address === 'unknown' || !address) {
      addTooltip('No account selected')
    } else {
      opts.udapp.removeAccount(address, (error) => {
        if (error) {
          addTooltip('Failed to remove account: ' + address)
        } else {
          fillAccountsList(appAPI, opts, document.body)
        }
      })
    }
  }

  // @rv: send transaction
  function sendCustomTransaction () {
    const $txOrigin = $('#txorigin')
    const address = $txOrigin.val()
    if (address === 'unknown' || !address) {
      addTooltip('No account selected')
    } else {
      opts.udapp.sendCustomTransaction(address, (error) => {
        if (error) {
          appAPI.logMessage(`transact from ${address} errored: ${error}`)
        } else {
          // Do nothing.
        }
      })
    }
  }

  // @rv: export private key
  function exportPrivateKey () {
    const $txOrigin = $('#txorigin')
    const address = $txOrigin.val()
    if (address === 'unknown' || !address) {
      addTooltip('No account selected')
    } else {
      opts.udapp.exportPrivateKey(address, (error) => {
        if (error) {
          addTooltip('Failed to export private key for account: ' + address + '\n' + error)
        } else {
          fillAccountsList(appAPI, opts, document.body)
        }
      })
    }
  }

  // @rv: connect to custom rpc
  function connectToCustomRPC () {
    opts.udapp.connectToCustomRPC((error, customRPC) => {
      if (error) {
        addTooltip('Failed to connect to Custom RPC: ' + error)
      } else {
        const $environmentSelect = $('#selectExEnvOptions')
        let find = false
        const $options = $('option', $environmentSelect)
        for (let i = 0; i < $options.length; i++) {
          if ($options[i].getAttribute('value') === customRPC.context) {
            find = true
            break
          }
        }
        if (!find) {
          $environmentSelect.append($(`
            <option title="Custom RPC connection."
                  value="${customRPC.context}" name="executionContext"> ${customRPC.name}
            </option>`))
        }
        $environmentSelect[0].value = customRPC.context
        $environmentSelect[0].dispatchEvent(new window.Event('change'))
      }
    })
  }

  // @rv: remove custom rpc by context
  function removeCustomRPCByContext (context) {
    const $environmentSelect = $('#selectExEnvOptions')
    const customRPCList = opts.config.get('custom-rpc-list')
    const newCustomRPCList = []
    for (let i = 0; i < customRPCList.length; i++) {
      if (customRPCList[i].context !== context) {
        newCustomRPCList.push(customRPCList[i])
      }
    }

    opts.config.set('custom-rpc-list', newCustomRPCList) // update `custom-rpc-list`

    const newContext = newCustomRPCList.length ? newCustomRPCList[0].context : 'vm' // change selected environment
    $environmentSelect[0].value = newContext

    const $options = $('option', $environmentSelect) // remove from gui
    for (let i = 0; i < $options.length; i++) {
      if ($options[i].getAttribute('value') === context) {
        $options[i].remove()
        break
      }
    }
    $environmentSelect[0].dispatchEvent(new window.Event('change'))
  }

  // @rv: remove custom rpc
  function removeCustomRPC () {
    const $environmentSelect = $('#selectExEnvOptions')
    const context = $environmentSelect.val()
    return removeCustomRPCByContext(context)
  }

  // @rv: setup predefined Custom RPCs
  function setupPredefinedCustomRPCs () {
    const customRPCList = []
    const rpcUrl = (window.location.protocol + '//' + window.location.hostname + ':8546/')
    function addIfNotExists (customRPC) {
      let find = false
      for (let i = 0; i < customRPCList.length; i++) {
        if (customRPCList[i].context === customRPC.context) {
          find = true
          customRPCList[i] = customRPC // Force overwrite.
          break
        }
      }
      if (!find) {
        customRPCList.push(customRPC)
      }
    }
    addIfNotExists({
      name: 'Unknown Network',
      context: 'custom-rpc-iohk-testnet',
      chainId: undefined,
      rpcUrl: rpcUrl,
      vm: 'evm'
    })
    // You can click `Connect to Custom RPC` button to connect to custom rpc node to do your development testing.
    opts.config.set('custom-rpc-list', customRPCList)
  }

  return el
}

// @rv: show/hide specific elements
function toggleRVElements () {
  if (executionContext.isCustomRPC()) {
    $('#account-extra-section').show()

    const context = executionContext.getProvider()
    if (context === 'custom-rpc-iohk-testnet') {
      // $('#request-from-faucet-btn').show()
      $('#remove-custom-rpc-icon').hide()
    } else {
      // $('#request-from-faucet-btn').hide()
      $('#remove-custom-rpc-icon').show()
    }
  } else {
    $('#account-extra-section').hide()
    $('#remove-custom-rpc-icon').hide()
  }
}

module.exports = runTab
