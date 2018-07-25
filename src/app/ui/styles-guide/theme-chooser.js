// var remixLib = require('remix-lib')
var styleGuideLight = require('./style-guide')
var styleGuideDark = require('./styleGuideDark')
var styleGuideCardano = require('./styleGuideCardano')
var Storage = require('remix-lib').Storage
module.exports = {

  chooser: function () {
    var themeStorage = new Storage('style:')
    if (themeStorage.exists('theme')) {
      if (themeStorage.get('theme') === 'dark') {
        return styleGuideDark()
      } else if (themeStorage.get('theme') === 'light') {
        return styleGuideLight()
      } else {
        return styleGuideCardano()
      }
    } else {
      return styleGuideCardano()
    }
  },

  switchTheme: function (theme) {
    var themeStorage = new Storage('style:')
    themeStorage.set('theme', theme)
    if (theme === 'dark') {
      return styleGuideDark()
    } else if (theme === 'light') {
      return styleGuideLight()
    } else {
      return styleGuideCardano()
    }
  }
}
