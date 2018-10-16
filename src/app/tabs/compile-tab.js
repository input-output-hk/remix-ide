const yo = require('yo-yo')
const csjs = require('csjs-inject')
const minixhr = require('minixhr')
const helper = require('../../lib/helper')
const TreeView = require('../ui/TreeView')
const modalDialog = require('../ui/modaldialog')
const copyToClipboard = require('../ui/copy-to-clipboard')
const modalDialogCustom = require('../ui/modal-dialog-custom')
const styleGuide = require('../ui/styles-guide/theme-chooser')
const parseContracts = require('../contract/contractParser')
const publishOnSwarm = require('../contract/publishOnSwarm')
const executionContext = require('../../execution-context')
const tooltip = require('../ui/tooltip')
const QueryParams = require('../../lib/query-params')

const styles = styleGuide.chooser()

module.exports = class CompileTab {
  constructor (api = {}, events = {}, opts = {}) {
    const self = this
    self._opts = opts
    self._api = api
    self._events = events
    self._view = {
      el: null,
      autoCompile: null,
      compileToIELE: null,
      compileButton: null,
      warnCompilationSlow: null,
      compileIcon: null,
      compileContainer: null,
      errorContainer: null,
      contractNames: null,
      contractEl: null,
      versionSelector: null,
      version: null
    }
    self.data = {
      autoCompile: self._opts.config.get('autoCompile'),
      compileToIELE: self._opts.config.get('compileToIELE'),
      compileTimeout: null,
      contractsDetails: {},
      maxTime: 1000,
      timeout: 300,
      allversions: null,
      selectedVersion: null,
      baseurl: 'https://solc-bin.ethereum.org/bin'
    }
    self._components = {
      queryParams: new QueryParams()
    }
    self.fetchAllVersion((allversions, selectedVersion) => {
      self.data.allversions = allversions
      self.data.selectedVersion = selectedVersion
      if (self._view.versionSelector) self.updateVersionSelector()
    })
    self._events.editor.register('contentChanged', scheduleCompilation)
    self._events.editor.register('sessionSwitched', scheduleCompilation)
    function scheduleCompilation () {
      if (!self._opts.config.get('autoCompile')) return
      if (self.data.compileTimeout) window.clearTimeout(self.data.compileTimeout)
      self.data.compileTimeout = window.setTimeout(() => self._api.runCompiler(), self.data.timeout)
    }
    self._events.compiler.register('compilationDuration', function tabHighlighting (speed) {
      if (!self._view.warnCompilationSlow) return
      if (speed > self.data.maxTime) {
        const msg = `Last compilation took ${speed}ms. We suggest to turn off autocompilation.`
        self._view.warnCompilationSlow.setAttribute('title', msg)
        self._view.warnCompilationSlow.style.display = 'inline-block'
      } else {
        self._view.warnCompilationSlow.style.display = 'none'
      }
    })
    self._events.editor.register('contentChanged', function changedFile () {
      if (!self._view.compileIcon) return
      const compileTab = document.querySelector('.compileView') // @TODO: compileView tab
      compileTab.style.color = styles.colors.red // @TODO: compileView tab
      self._view.compileIcon.classList.add(`${css.bouncingIcon}`) // @TODO: compileView tab
    })
    self._events.compiler.register('loadingCompiler', function start () {
      if (!self._view.compileIcon) return
      self._view.compileIcon.classList.add(`${css.spinningIcon}`)
      self._view.warnCompilationSlow.style.display = 'none'
      self._view.compileIcon.setAttribute('title', 'compiler is loading, please wait a few moments.')
    })
    self._events.compiler.register('compilationStarted', function start () {
      if (!self._view.compileIcon) return
      self._view.errorContainer.innerHTML = ''
      self._view.compileIcon.classList.remove(`${css.bouncingIcon}`)
      self._view.compileIcon.classList.add(`${css.spinningIcon}`)
      self._view.compileIcon.setAttribute('title', 'compiling...')
    })
    self._events.compiler.register('compilerLoaded', function loaded () {
      if (!self._view.compileIcon) return
      self._view.compileIcon.classList.remove(`${css.spinningIcon}`)
      self._view.compileIcon.setAttribute('title', '')
    })
    self._events.compiler.register('compilerLoaded', (version) => self.setVersionText(version))
    self._events.compiler.register('compilationFinished', function finish (success, data, source) {
      // console.log('@compile-tab.js compilationFinished: ', success, data, source)
      if (self._view.compileIcon) {
        const compileTab = document.querySelector('.compileView')
        compileTab.style.color = styles.colors.black
        self._view.compileIcon.style.color = styles.colors.black
        self._view.compileIcon.classList.remove(`${css.spinningIcon}`)
        self._view.compileIcon.classList.remove(`${css.bouncingIcon}`)
        self._view.compileIcon.setAttribute('title', 'idle')
      }
      // reset the contractMetadata list (used by the publish action)
      self.data.contractsDetails = {}
      // refill the dropdown list
      self._view.contractNames.innerHTML = ''
      if (success) {
        self._view.contractNames.removeAttribute('disabled')
        self._opts.compiler.visitContracts(contract => {
          self.data.contractsDetails[contract.name] = parseContracts(contract.name, contract.object, self._opts.compiler.getSource(contract.file))
          var contractName = yo`<option>${contract.name}</option>`
          self._view.contractNames.appendChild(contractName)
        })
        self._api.resetDapp(self.data.contractsDetails)
      } else {
        self._view.contractNames.setAttribute('disabled', true)
        self._api.resetDapp({})
      }
      // hightlight the tab if error
      if (success) document.querySelector('.compileView').style.color = '' // @TODO: compileView tab
      else document.querySelector('.compileView').style.color = styles.colors.red // @TODO: compileView tab
      // display warning error if any
      var error = false
      if (data['error']) {
        error = true
        self._opts.renderer.error(data['error'].formattedMessage, self._view.errorContainer, {type: data['error'].severity})
      }
      if (data.errors && data.errors.length) {
        error = true
        data.errors.forEach(function (err) {
          self._opts.renderer.error(err.formattedMessage, self._view.errorContainer, {type: err.severity})
        })
      }
      if (!error && data.contracts) {
        self._opts.compiler.visitContracts((contract) => {
          self._opts.renderer.error(contract.name, self._view.errorContainer, {type: 'success'})
        })
      }
    })
    self._events.staticAnalysis.register('staticAnaysisWarning', (count) => {
      if (count) {
        const msg = `Static Analysis raised ${count} warning(s) that requires your attention. Click here to show the warning(s).`
        const settings = { type: 'staticAnalysisWarning', click: () => self._api.switchTab('staticanalysisView'), useSpan: true }
        self._opts.renderer.error(msg, self._view.errorContainer, settings)
      }
    })

    // @rv
    executionContext.event.register('contextChanged', async () => {
      self._opts.config.set('compileToIELE', executionContext.isIeleVM())
      let compileToIELE = document.getElementById('compileToIELE')
      if (!compileToIELE) {
        compileToIELE = await new Promise((resolve, reject) => {
          setTimeout(() => {
            return resolve(document.getElementById('compileToIELE'))
          }, 1000)
        })
      }
      if (compileToIELE) {
        const solidityCompilerVersionSelector = document.getElementById('solidity-compiler-version-selector')
        if (executionContext.isIeleVM()) {
          solidityCompilerVersionSelector.style.display = 'none'
          compileToIELE.setAttribute('checked', '')
        } else {
          solidityCompilerVersionSelector.style.display = 'block'
          compileToIELE.removeAttribute('checked')
        }
      }
    })
  }

  fetchAllVersion (callback) {
    var self = this
    minixhr(`${self.data.baseurl}/list.json`, function (json, event) {
      // @TODO: optimise and cache results to improve app loading times
      var allversions, selectedVersion
      if (event.type !== 'error') {
        try {
          const data = JSON.parse(json)
          allversions = data.builds.slice().reverse()
          selectedVersion = data.releases[data.latestRelease]
          if (self._components.queryParams.get().version) selectedVersion = self._components.queryParams.get().version
        } catch (e) {
          tooltip('Cannot load compiler version list. It might have been blocked by an advertisement blocker. Please try deactivating any of them from this page and reload.')
        }
      } else {
        allversions = [{ path: 'builtin', longVersion: 'latest local version' }]
        selectedVersion = 'builtin'
      }
      callback(allversions, selectedVersion)
    })
  }

  updateVersionSelector () {
    const self = this
    self._view.versionSelector.innerHTML = ''
    self._view.versionSelector.appendChild(yo`<option disabled selected>Select new compiler version</option>`)
    self.data.allversions.forEach(build => self._view.versionSelector.appendChild(yo`<option value=${build.path}>${build.longVersion}</option>`))
    self._view.versionSelector.removeAttribute('disabled')
    self._components.queryParams.update({ version: self.data.selectedVersion })
    var url
    if (self.data.selectedVersion === 'builtin') {
      var location = window.document.location
      location = location.protocol + '//' + location.host + '/' + location.pathname
      if (location.endsWith('index.html')) location = location.substring(0, location.length - 10)
      if (!location.endsWith('/')) location += '/'
      url = location + 'soljson.js'
    } else {
      if (self.data.selectedVersion.indexOf('soljson') !== 0 || helper.checkSpecialChars(self.data.selectedVersion)) {
        return console.log('loading ' + self.data.selectedVersion + ' not allowed')
      }
      url = `${self.data.baseurl}/${self.data.selectedVersion}`
    }

    self._opts.compiler.loadVersion(false, url)
    self.setVersionText('(loading)')
  }

  setVersionText (text) {
    const self = this
    self.data.version = text
    if (self._view.version) self._view.version.innerText = text
  }

  onchangeLoadVersion (event) {
    const self = this
    self.data.selectedVersion = self._view.versionSelector.value
    self.updateVersionSelector()
  }

  render () {
    const self = this
    if (self._view.el) return self._view.el
    self._view.warnCompilationSlow = yo`<i title="Copy Address" style="display:none" class="${css.warnCompilationSlow} fa fa-exclamation-triangle" aria-hidden="true"></i>`
    self._view.compileIcon = yo`<i class="fa fa-refresh ${css.icon}" aria-hidden="true"></i>`
    self._view.compileButton = yo`<div class="${css.compileButton}" onclick=${compile} id="compile" title="Compile source code">${self._view.compileIcon} Start to compile</div>`
    self._view.autoCompile = yo`<input class="${css.autocompile}" onchange=${updateAutoCompile} id="autoCompile" type="checkbox" title="Auto compile">`
    self._view.compileToIELE = yo`<input class="${css.compileToIELE}" onchange=${updateCompileToIELE} id="compileToIELE" type="checkbox" title="Compile to IELE">`
    if (self.data.autoCompile) self._view.autoCompile.setAttribute('checked', '')
    if (self.data.compileToIELE) self._view.compileToIELE.setAttribute('checked', '')
    self._view.version = yo`<span id="version"></span>`
    self._view.versionSelector = yo`
    <select onchange=${self.onchangeLoadVersion.bind(self)} class="${css.select}" id="versionSelector" disabled>
      <option disabled selected>Select new compiler version</option>
    </select>`
    if (self.data.allversions && self.data.selectedVersion) self.updateVersionSelector()
    self._view.compileContainer = yo`
      <div class="${css.compileContainer}">
        <div id="solidity-compiler-version-selector" style="display:none;">
          <span>Current version: </span> ${self._view.version}
          ${self._view.versionSelector}
        </div>
        <div class="${css.compileButtons}">
          ${self._view.compileButton}
          <div class="${css.settingsContainer}">
            <div class="${css.autocompileContainer}">
              ${self._view.autoCompile}
              <span class="${css.autocompileText}">Auto compile</span>
              ${self._view.warnCompilationSlow}
            </div>
            <div class="${css.compileToIELEContainer}" style="display:none;">
              ${self._view.compileToIELE}
              <span>Compile to IELE</span>
            </div>
          </div>
        </div>
      </div>`
    self._view.errorContainer = yo`<div class='error'></div>`
    self._view.contractNames = yo`<select class="${css.contractNames}" disabled></select>`
    self._view.contractEl = yo`
      <div class="${css.container}">
        ${self._view.contractNames}
        <div class="${css.contractButtons}">
          <div title="Display Contract Details" class="${css.details}" onclick=${details}>Details</div>
          <div title="Publish on Swarm" class="${css.publish}" onclick=${publish}>Publish on Swarm</div>
        </div>
      </div>`
    self._view.el = yo`
      <div class="${css.compileTabView}" id="compileTabView">
        ${self._view.compileContainer}
        ${self._view.contractEl}
        ${self._view.errorContainer}
      </div>`
    const help = {
      'Assembly': 'Assembly opcodes describing the contract including corresponding solidity source code',
      'IeleAssembly': 'IELE Assembly code describing the contract including corresponding solidity source code', // @rv
      'Opcodes': 'Assembly opcodes describing the contract',
      'Runtime Bytecode': 'Bytecode storing the state and being executed during normal contract call',
      'bytecode': 'Bytecode being executed during contract creation',
      'functionHashes': 'List of declared function and their corresponding hash',
      'gasEstimates': 'Gas estimation for each function call',
      'metadata': 'Contains all informations related to the compilation',
      'metadataHash': 'Hash representing all metadata information',
      'abi': 'ABI: describing all the functions (input/output params, scope, ...)',
      'name': 'Name of the compiled contract',
      'swarmLocation': 'Swarm url where all metadata information can be found (contract needs to be published first)',
      'web3Deploy': 'Copy/paste this code to any JavaScript/Web3 console to deploy this contract'
    }
    function updateAutoCompile (event) { self._opts.config.set('autoCompile', self._view.autoCompile.checked) }
    function updateCompileToIELE (event) { self._opts.config.set('compileToIELE', self._view.compileToIELE.checked) }
    function compile (event) { self._api.runCompiler() }
    function details () {
      const select = self._view.contractNames
      if (select.children.length > 0 && select.selectedIndex >= 0) {
        const contractName = select.children[select.selectedIndex].innerHTML
        const contractProperties = self.data.contractsDetails[contractName]
        const log = yo`<div class="${css.detailsJSON}"></div>`
        Object.keys(contractProperties).map(propertyName => {
          const copyDetails = yo`<span class="${css.copyDetails}">${copyToClipboard(() => contractProperties[propertyName])}</span>`
          const questionMark = yo`<span class="${css.questionMark}"><i title="${help[propertyName]}" class="fa fa-question-circle" aria-hidden="true"></i></span>`
          log.appendChild(yo`<div class=${css.log}>
            <div class="${css.key}">${propertyName} ${copyDetails} ${questionMark}</div>
            ${insertValue(contractProperties, propertyName)}
          </div>`)
        })
        modalDialog(contractName, log, { label: '' }, { label: 'Close' })
      }
    }
    function insertValue (details, propertyName) {
      var node
      if (propertyName === 'web3Deploy' || propertyName === 'name' || propertyName === 'Assembly' ||
          propertyName === 'IeleAssembly') { // @rv
        node = yo`<pre>${details[propertyName]}</pre>`
      } else if (propertyName === 'abi' || propertyName === 'metadata') {
        const treeView = new TreeView({
          extractData: function (item, parent, key) {
            var ret = {}
            if (item instanceof Array) {
              ret.children = item.map((item, index) => ({ key: index, value: item }))
              ret.self = ''
            } else if (item instanceof Object) {
              ret.children = Object.keys(item).map((key) => ({key: key, value: item[key]}))
              ret.self = ''
            } else {
              ret.self = item
              ret.children = []
            }
            return ret
          }
        })
        if (details[propertyName] !== '') {
          try {
            node = yo`<div>${treeView.render(typeof details[propertyName] === 'object' ? details[propertyName] : JSON.parse(details[propertyName]))}</div>` // catch in case the parsing fails.
          } catch (e) {
            node = yo`<div>Unable to display "${propertyName}": ${e.message}</div>`
          }
        } else {
          node = yo`<div> - </div>`
        }
      } else {
        node = yo`<div>${JSON.stringify(details[propertyName], null, 4)}</div>`
      }
      return yo`<pre class="${css.value}">${node || ''}</pre>`
    }
    function publish () {
      const selectContractNames = self._view.contractNames
      if (selectContractNames.children.length > 0 && selectContractNames.selectedIndex >= 0) {
        var contract = self.data.contractsDetails[selectContractNames.children[selectContractNames.selectedIndex].innerHTML]
        if (contract.metadata === undefined || contract.metadata.length === 0) {
          modalDialogCustom.alert('This contract does not implement all functions and thus cannot be published.')
        } else {
          publishOnSwarm(contract, self._api, function (err) {
            if (err) {
              try {
                err = JSON.stringify(err)
              } catch (e) {}
              modalDialogCustom.alert(yo`<span>Failed to publish metadata file to swarm, please check the Swarm gateways is available ( swarm-gateways.net ).<br />
              ${err}</span>`)
            } else {
              modalDialogCustom.alert(yo`<span>Metadata published successfully.<br />The Swarm address of the metadata file is available in the contract details.</span>`)
            }
          }, function (item) { // triggered each time there's a new verified publish (means hash correspond)
            self._api.fileProvider('swarm').addReadOnly(item.hash, item.content)
          })
        }
      }
    }
    return self._view.el
  }
}

const css = csjs`
  .compileTabView {
    padding: 2%;
  }
  .contract {
    display: block;
    margin: 3% 0;
  }
  .compileContainer  {
    ${styles.rightPanel.compileTab.box_CompileContainer};
    margin-bottom: 2%;
  }
  .autocompileContainer {
    width: 100%;
    display: flex;
    align-items: center;
  }
  .autocompile {}
  .autocompileTitle {
    font-weight: bold;
    margin: 1% 0;
  }
  .autocompileText {
    margin: 1% 0;
    font-size: 12px;
    overflow: hidden;
    word-break: normal;
    line-height: initial;
  }
  .warnCompilationSlow {
    color: ${styles.rightPanel.compileTab.icon_WarnCompilation_Color};
    margin-left: 6px;
  }
  .compileToIELEContainer {
    display: flex;
    align-items: center;
  }
  .compileButtons {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
  }
  .settingsContainer {
    flex: 1;
  }
  .name {
    display: flex;
  }
  .size {
    display: flex;
  }
  .compileButton {
    ${styles.rightPanel.compileTab.button_Compile};
    width: 200px;
    min-width: 110px;
    margin-right: 1%;
    font-size: 12px;
  }
  .container {
    ${styles.rightPanel.compileTab.box_CompileContainer};
    margin: 0;
    display: flex;
    align-items: center;
  }
  .contractNames {
    ${styles.rightPanel.compileTab.dropdown_CompileContract};
    margin-right: 5%;
  }
  .contractButtons {
    display: flex;
    cursor: pointer;
    justify-content: center;
    text-align: center;
  }
  .details {
    ${styles.rightPanel.compileTab.button_Details};
  }
  .publish {
    ${styles.rightPanel.compileTab.button_Publish};
    margin-left: 2%;
    width: 120px;
    display: none !important; /* @rv: disable (hide) "Publish on Swarm" button */
  }
  .log {
    ${styles.rightPanel.compileTab.box_CompileContainer};
    display: flex;
    flex-direction: column;
    margin-bottom: 5%;
    overflow: visible;
  }
  .key {
    margin-right: 5px;
    color: ${styles.rightPanel.text_Primary};
    text-transform: uppercase;
    width: 100%;
  }
  .value {
    display: flex;
    width: 100%;
    margin-top: 1.5%;
  }
  .questionMark {
    margin-left: 2%;
    cursor: pointer;
    color: ${styles.rightPanel.icon_Color_TogglePanel};
  }
  .questionMark:hover {
    color: ${styles.rightPanel.icon_HoverColor_TogglePanel};
  }
  .select {
    font-weight: bold;
    margin-top: 1em;
    margin-bottom: 1em;
    ${styles.rightPanel.settingsTab.dropdown_SelectCompiler}
    width: 100%;
  }
  .detailsJSON {
    padding: 8px 0;
    background-color: ${styles.rightPanel.modalDialog_BackgroundColor_Primary};
    border: none;
    color: ${styles.rightPanel.modalDialog_text_Secondary};
  }
  .icon {
    margin-right: 3%;
  }
  .spinningIcon {
    margin-right: .3em;
    animation: spin 2s linear infinite;
  }
  .bouncingIcon {
    margin-right: .3em;
    animation: bounce 2s infinite;
  }
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  @-webkit-keyframes bounce {
    0% {
      margin-bottom: 0;
      color: ${styles.colors.transparent};
    }
    70% {
      margin-bottom: 0;
      color: ${styles.rightPanel.text_Secondary};
    }
    100% {
      margin-bottom: 0;
      color: ${styles.colors.transparent};
    }
  }
`
