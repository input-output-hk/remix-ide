/* global */
'use strict'

var $ = require('jquery')
var yo = require('yo-yo')
var helper = require('./lib/helper')
var copyToClipboard = require('./app/ui/copy-to-clipboard')
var css = require('./universal-dapp-styles')
var MultiParamManager = require('./multiParamManager')

/*
  trigger debugRequested
*/
function UniversalDAppUI (udapp, opts = {}) {
  var self = this
  this.udapp = udapp
  self.el = yo`<div class=${css.udapp}></div>`
}

UniversalDAppUI.prototype.reset = function () {
  this.el.innerHTML = ''
}

UniversalDAppUI.prototype.renderInstance = function (contract, address, contractName) {
  var noInstances = document.querySelector('[class^="noInstancesText"]')
  if (noInstances) {
    noInstances.parentNode.removeChild(noInstances)
  }
  var abi = this.udapp.getABI(contract)
  return this.renderInstanceFromABI(abi, address, contractName)
}

// TODO this function was named before "appendChild".
// this will render an instance: contract name, contract address, and all the public functions
// basically this has to be called for the "atAddress" (line 393) and when a contract creation succeed
// this returns a DOM element
UniversalDAppUI.prototype.renderInstanceFromABI = function (contractABI, address, contractName) { // TODO: support IELE
  // console.log('@universal-dapp-ui.js UniversalDAppUI.prototype.renderInstanceFromABI')
  // console.log('* contractABI: ', contractABI)
  // console.log('* address: ', address)
  // console.log('* contractName: ', contractName)
  var self = this
  address = (address.slice(0, 2) === '0x' ? '' : '0x') + address.toString('hex')
  var instance = yo`<div class="instance ${css.instance} ${css.hidesub}" id="instance${address}"></div>`
  var context = self.udapp.context()

  var shortAddress = helper.shortenAddress(address)
  var title = yo`
    <div class="${css.title}" onclick=${toggleClass}>
    <div class="${css.titleText}"> ${contractName} at ${shortAddress} (${context}) </div>
    ${copyToClipboard(() => address)}
  </div>`

  if (self.udapp.removable_instances) {
    var close = yo`<div class="${css.udappClose}" onclick=${remove}><i class="${css.closeIcon} fa fa-close" aria-hidden="true"></i></div>`
    title.appendChild(close)
  }

  function remove () {
    instance.remove()
    // @TODO perhaps add a callack here to warn the caller that the instance has been removed
  }

  function toggleClass () {
    $(instance).toggleClass(`${css.hidesub}`)
  }

  instance.appendChild(title)

  // Add the fallback function
  var fallback = self.udapp.getFallbackInterface(contractABI)
  if (fallback) {
    instance.appendChild(this.getCallButton({
      funABI: fallback,
      address: address,
      contractAbi: contractABI,
      contractName: contractName
    }))
  }

  // check if the source language is iele
  let isIeleLanguage = !!(contractABI.filter((x)=> x.type === 'constructor' && x.name === 'init').length)

  $.each(contractABI, (i, funABI) => {
    if (funABI.type !== 'function') {
      return
    }
    // @todo getData cannot be used with overloaded functions
    instance.appendChild(this.getCallButton({
      funABI: funABI,
      address: address,
      contractAbi: contractABI,
      contractName: contractName,
      isIeleLanguage,
      sourceLanguage: isIeleLanguage ? 'iele' : 'solidity'
    }))
  })

  return instance
}

// TODO this is used by renderInstance when a new instance is displayed.
// this returns a DOM element.
/**
 * @rv: modify this function to support IELE function
 * @param {{funABI:object, address: string, contractAbi: string, contractName: string, isIeleLanguage: boolean}} args
 */
UniversalDAppUI.prototype.getCallButton = function (args) {
  // console.log('@universal-dapp-ui.js UniversalDAppUI.prototype.getCallButton')
  // console.log('* args: ', args)
  const isIeleLanguage = args.isIeleLanguage
  const self = this
  // args.funABI, args.address [fun only]
  // args.contractName [constr only]
  function helper(lookupOnly) {  
    var outputOverride = yo`<div class=${css.value}></div>` // show return value
  
    function clickButton (valArr, inputsValues) {
      const newArgs = Object.assign({}, args)
      // @rv: attach `constant` to funABI if isIeleLanguage and lookupOnly
      if (isIeleLanguage) {
        const newFunABI = Object.assign({}, args.funABI)
        newFunABI.constant = lookupOnly
        newArgs.funABI = newFunABI
      }
      self.udapp.call(true, newArgs, inputsValues, lookupOnly, (decoded) => {
        outputOverride.innerHTML = ''
        outputOverride.appendChild(decoded)
      })
    }
  
    const multiParamManager = new MultiParamManager(lookupOnly, args.funABI, (valArray, inputsValues, domEl) => {
      clickButton(valArray, inputsValues, domEl)
    }, self.udapp.getInputs(args.funABI), '')
  
    const contractActionsContainer = yo`<div class="${css.contractActionsContainer}" >${multiParamManager.render()}</div>`
    contractActionsContainer.appendChild(outputOverride)
  
    return contractActionsContainer 
  }

  if (isIeleLanguage) { // @rv: display both `call` and `transact` for function.
    return yo`<div>
    ${helper(true)}
    ${helper(false)}
    </div>`
  } else {
    const lookupOnly = args.funABI.constant
    return helper(lookupOnly)
  }
}

module.exports = UniversalDAppUI
