var yo = require('yo-yo')
var csjs = require('csjs-inject')
var remixLib = require('remix-lib')
var QueryParams = require('../../lib/query-params')
var modal = require('../ui/modal-dialog-custom')
var tooltip = require('../ui/tooltip')
var copyToClipboard = require('../ui/copy-to-clipboard')
var styleGuide = require('../ui/styles-guide/theme-chooser')

var styles = styleGuide.chooser()
var Storage = remixLib.Storage
var EventManager = remixLib.EventManager

module.exports = class SettingsTab {
  constructor (api = {}, events = {}, opts = {}) {
    const self = this
    self._opts = opts
    self._api = api
    self._events = events
    self._components = {}
    self._view = { /* eslint-disable */
      el: null,
      optionVM: null, personal: null, optimize: null, warnPersonalMode: null,
      pluginInput: null,
      theme: { dark: null, light: null, cardano: null },
      config: {
        solidity: null, general: null, themes: null,
        plugin: null, remixd: null, localremixd: null
      }
    } /* eslint-enable */
    self.data = {
    }
    self.event = new EventManager()
    self._components.queryParams = new QueryParams()
    self._components.themeStorage = new Storage('style:')
    self.data.optimize = !!self._components.queryParams.get().optimize
    self._components.queryParams.update({ optimize: self.data.optimize })
    self._api.setOptimize(self.data.optimize, false)
    self.data.currentTheme = self._components.themeStorage.get('theme') || 'cardano'
  }
  render () {
    const self = this
    if (self._view.el) return self._view.el

    // Gist settings
    var gistAccessToken = yo`<input id="gistaccesstoken" type="password">`
    var token = self._opts.config.get('settings/gist-access-token')
    if (token) gistAccessToken.value = token
    var gistAddToken = yo`<input class="${css.savegisttoken}" id="savegisttoken" onclick=${() => { self._opts.config.set('settings/gist-access-token', gistAccessToken.value); tooltip('Access token saved') }} value="Save" type="button">`
    var gistRemoveToken = yo`<input id="removegisttoken" onclick=${() => { gistAccessToken.value = ''; self._opts.config.set('settings/gist-access-token', ''); tooltip('Access token removed') }} value="Remove" type="button">`
    self._view.gistToken = yo`<div class="${css.checkboxText}">${gistAccessToken}${copyToClipboard(() => self._opts.config.get('settings/gist-access-token'))}${gistAddToken}${gistRemoveToken}</div>`
    //
    self._view.optionVM = yo`<input onchange=${onchangeOption} id="alwaysUseVM" type="checkbox">`
    if (self._opts.config.get('settings/always-use-vm')) self._view.optionVM.setAttribute('checked', '')
    self._view.personal = yo`<input onchange=${onchangePersonal} id="personal" type="checkbox">`
    if (self._opts.config.get('settings/personal-mode')) self._view.personal.setAttribute('checked', '')
    self._view.optimize = yo`<input onchange=${onchangeOptimize} id="optimize" type="checkbox">`
    if (self.data.optimize) self._view.optimize.setAttribute('checked', '')
    var warnText = `Transaction sent over Web3 will use the web3.personal API - be sure the endpoint is opened before enabling it.
    This mode allows to provide the passphrase in the Remix interface without having to unlock the account.
    Although this is very convenient, you should completely trust the backend you are connected to (Geth, Parity, ...).
    It is not recommended (and also most likely not relevant) to use this mode with an injected provider (Mist, Metamask, ...) or with JavaScript VM.
    Remix never persist any passphrase.`.split('\n').map(s => s.trim()).join(' ')
    self._view.warnPersonalMode = yo`<i title=${warnText} class="${css.icon} fa fa-exclamation-triangle" aria-hidden="true"></i>`
    self._view.pluginInput = yo`<textarea rows="4" cols="70" id="plugininput" type="text" class="${css.pluginTextArea}" ></textarea>`
    self._view.theme.cardano = yo`<input onchange=${onswitch2CardanoTheme} class="${css.col1}" name="theme" id="themeCardano" type="radio">`
    self._view.theme.light = yo`<input onchange=${onswitch2lightTheme} class="${css.col1}" name="theme" id="themeLight" type="radio">`
    self._view.theme.dark = yo`<input onchange=${onswitch2darkTheme} class="${css.col1}" name="theme" id="themeDark" type="radio">`
    self._view.theme[self.data.currentTheme].setAttribute('checked', 'checked')
    self._view.config.general = yo`
      <div class="${css.info}">
          <div class=${css.title}>General settings</div>
          <div class="${css.crow}" style="display:none;">
            <div>${self._view.optionVM}</div>
            <span class="${css.checkboxText}">Always use Ethereum VM at Load</span>
          </div>
          <div class="${css.crow}">
            <div><input id="editorWrap" type="checkbox"></div>
            <span class="${css.checkboxText}">Text Wrap</span>
          </div>
          <div class="${css.crow}">
            <div>${self._view.optimize}</div>
            <span class="${css.checkboxText}">Enable Optimization</span>
          </div>
          <div class="${css.crow}">
            <div>${self._view.personal}></div>
            <span class="${css.checkboxText}">Enable Personal Mode ${self._view.warnPersonalMode}></span>
          </div>
      </div>
      `
    self._view.gistToken = yo`
      <div class="${css.info}">
        <div class=${css.title}>Gist Access Token</div>
        <div class="${css.crowNoFlex}">Manage the access token used to publish to Gist.</div>
        <div class="${css.crowNoFlex}">Go to github token page (link below) to create a new token and save it in Remix. Make sure this token has only 'create gist' permission.</div>
        <div class="${css.crowNoFlex}"><a class="${css.linkStyle}" target="_blank" href="https://github.com/settings/tokens">https://github.com/settings/tokens</a></div>
        <div class="${css.crowNoFlex}">${self._view.gistToken}</div>
      </div>`
    self._view.config.themes = yo`
      <div class="${css.info}">
        <div class=${css.title}>Themes</div>
        <div class=${css.attention}>
          <i title="Select the theme" class="${css.icon} fa fa-exclamation-triangle" aria-hidden="true"></i>
          <span>Selecting a theme will trigger a page reload</span>
        </div>
        <div class="${css.crow}">
          ${self._view.theme.cardano}
          <label for="themeCardano">Cardano Theme</label>
        </div>
        <div class="${css.crow}">
          ${self._view.theme.light}
          <label for="themeLight">Light Theme</label>
        </div>
        <div class="${css.crow}">
          ${self._view.theme.dark}
          <label for="themeDark">Dark Theme</label>
        </div>
      </div>`
    self._view.config.plugin = yo`
      <div class="${css.info}">
        <div class=${css.title}>Plugin</div>
        <div class="${css.crowNoFlex}">
          <div class=${css.attention}>
            <i title="Do not use this feature yet" class="${css.icon} fa fa-exclamation-triangle" aria-hidden="true"></i>
            <span> Do not use this alpha feature if you are not sure what you are doing!</span>
          </div>
          <div>
            ${self._view.pluginInput}
            <input onclick=${onloadPlugin} type="button" value="Load" class="${css.pluginLoad}">
          </div>
        </div>
      </div>`
    self._view.config.remixd = yo`
      <div class="${css.info}">
        <div class=${css.title}>Remixd</div>
        <div class="${css.crow}">
          Remixd is a tool which allow Remix IDE to access files located in your local computer.
          it can also be used to setup a development environment.
        </div>
        <div class="${css.crow}">More infos:</div>
        <div class="${css.crow}"><a class="${css.linkStyle}" target="_blank" href="https://github.com/ethereum/remixd"> https://github.com/ethereum/remixd</a></div>
        <div class="${css.crow}"><a class="${css.linkStyle}" target="_blank" href="https://remix.readthedocs.io/en/latest/tutorial_remixd_filesystem">http://remix.readthedocs.io/en/latest/tutorial_remixd_filesystem.html</a></div>
        <div class="${css.crow}">Installation: <pre class=${css.remixdinstallation}>npm install remixd -g</pre></div>
      </div>`
    self._view.config.localremixd = yo`
      <div class="${css.info}">
        <div class=${css.title}>Running Remix locally</div>
        <div class="${css.crow}">
          as a NPM module:
        </div>
        <a class="${css.linkStyle}" target="_blank" href="https://www.npmjs.com/package/remix-ide">https://www.npmjs.com/package/remix-ide</a>
        <pre class=${css.remixdinstallation}>npm install remix-ide -g</pre>
        <div class="${css.crow}">
          as an electron app:
        </div>
        <a class="${css.linkStyle}" target="_blank" href="https://github.com/horizon-games/remix-app">https://github.com/horizon-games/remix-app</a>
      </div>`
    self._view.el = yo`
      <div class="${css.settingsTabView} "id="settingsView">
        ${self._view.config.general}
        ${self._view.gistToken}
        ${self._view.config.themes}
        ${self._view.config.plugin}
      </div>`
    function onchangeOption (event) {
      self._opts.config.set('settings/always-use-vm', !self._opts.config.get('settings/always-use-vm'))
    }
    function onloadPlugin (event) {
      try {
        var json = JSON.parse(self._view.pluginInput.value)
      } catch (e) {
        return modal.alert('cannot parse the plugin definition to JSON')
      }
      // @TODO: BAD! REFACTOR: no module should trigger events of another modules emitter
      self._events.rhp.trigger('plugin-loadRequest', [json])
    }
    function onswitch2CardanoTheme (event) {
      styleGuide.switchTheme('cardano')
      window.location.reload()
    }
    function onswitch2darkTheme (event) {
      styleGuide.switchTheme('dark')
      window.location.reload()
    }
    function onswitch2lightTheme (event) {
      styleGuide.switchTheme('light')
      window.location.reload()
    }
    function onchangeOptimize (event) {
      self.data.optimize = !!self._view.optimize.checked
      self._components.queryParams.update({ optimize: self.data.optimize })
      self._api.setOptimize(self.data.optimize, true)
    }
    function onchangePersonal (event) {
      self._opts.config.set('settings/personal-mode', !self._opts.config.get('settings/personal-mode'))
    }
    return self._view.el
  }
}

const css = csjs`
  .settingsTabView {
    padding: 2%;
    display: flex;
  }
  .info {
    ${styles.rightPanel.settingsTab.box_SolidityVersionInfo}
    margin-bottom: 1em;
    word-break: break-word;
  }
  .title {
    font-size: 1.1em;
    font-weight: bold;
    margin-bottom: 1em;
  }
  .crow {
    display: flex;
    overflow: auto;
    clear: both;
    padding: .2em;
  }
  .checkboxText {
    font-weight: normal;
  }
  .crow label {
    cursor:pointer;
  }
  .crowNoFlex {
    overflow: auto;
    clear: both;
  }
  .linkStyle {
    color: ${styles.appProperties.specialText_Color};
  }
  .attention {
    margin-bottom: 1em;
    padding: .5em;
    font-weight: bold;
  }
  .heading {
    margin-bottom: 0;
  }
  .explaination {
    margin-top: 3px;
    margin-bottom: 3px;
  }
  input {
    margin-right: 5px;
    cursor: pointer;
  }
  input[type=radio] {
    margin-top: 2px;
  }
  .pluginTextArea {
    font-family: unset;
  }
  .pluginLoad {
    vertical-align: top;
  }
  i.warnIt {
    color: ${styles.appProperties.warningText_Color};
  }
  .icon {
    margin-right: .5em;
  }
  .remixdinstallation {
    padding: 3px;
    border-radius: 2px;
    margin-left: 5px;
  }
  .savegisttoken {
    margin-left: 5px;
  }
`
