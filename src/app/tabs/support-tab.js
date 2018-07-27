const yo = require('yo-yo')
const csjs = require('csjs-inject')
const remixLib = require('remix-lib')

const styles = require('../ui/styles-guide/theme-chooser').chooser()

const EventManager = remixLib.EventManager

module.exports = class SupportTab {
  constructor (api = {}, events = {}, opts = {}) {
    const self = this
    self.event = new EventManager()
    self._api = api
    self._events = events
    self._opts = opts
    self._view = { el: null }
    self.data = {}
    self._components = {}
    self._events.app.register('tabChanged', (tabName) => {
      if (tabName !== 'Support') return
      yo.update(self._view.el, self.render())
      self._view.el.style.display = 'block'
    })
  }
  render () {
    const self = this
    var el = yo`
      <div class="${css.supportTabView}" id="supportView">
        <div class="${css.infoBox}">
          <p>Your feedback is important because it helps us improve IELE
          and the testnet. We have set up several communication
          channels to help with the process:</p>

          <ul class="${css.linkList}">
            <li>Telegram: <a class="${css.linkStyle}" target="_blank" href="https://t.me/CardanoDevelopersOfficial">CardanoDevelopersOfficial</a> channel</li>
            <li>Email technical support: <a class="${css.linkStyle}" href="mailto:testnet.goguen@iohk.io">testnet.goguen@iohk.io</a></li>
            <li>Stack Exchange: <a class="${css.linkStyle}" target="_blank" href="https://area51.stackexchange.com/proposals/118211/cardano/118216#11821">Cardano StackExchange</a></li>
          </ul>
        </div>
      </div>`
    if (!self._view.el) self._view.el = el
    return el
  }
}

const css = csjs`
  .supportTabView {
    height: 100vh;
    padding: 2%;
    padding-bottom: 3em;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .linkList {
    padding-left: 3em;
  }
  .linkStyle {
    color: ${styles.appProperties.specialText_Color}
  }
  .infoBox {
    ${styles.rightPanel.supportTab.box_SupportInfo}
  }
`
