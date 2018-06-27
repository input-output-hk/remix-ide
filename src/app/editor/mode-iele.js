/*
 * IELE syntax file
 * " IELE syntax file
 * "    Language: IELE
 * "    Revision: 1.0
 * "  Maintainer: Runtime Verification
 * " Last Change: 2018 April
 * 
 * References:
 *  https://github.com/ajaxorg/ace/wiki/Creating-or-Extending-an-Edit-Mode
 *  https://github.com/ajaxorg/ace/blob/master/tool/tmtheme.js
 */
var ace = window.ace
ace.define('ace/mode/iele', ['require', 'exports', 'module', 'ace/lib/oop', 'ace/mode/text_highlight_rules'], function (acequire, exports, module) {
  var oop = acequire('../lib/oop');
  var TextHighlightRules = acequire("./text_highlight_rules").TextHighlightRules;
  var TextMode = acequire("./text").Mode
  var CstyleBehaviour = acequire("./behaviour/cstyle").CstyleBehaviour
  var CStyleFoldMode = acequire("./folding/cstyle").FoldMode
  var MatchingBraceOutdent = acequire("./matching_brace_outdent").MatchingBraceOutdent
  var IELEHighlightRules = function () {
    var keywordMapper = this.createKeywordMapper({
      'variable.language': 'this',
      'keyword': 'ret revert br at load store sload sstore ' +
        'log create copycreate selfdestruct deposit init send gaslimit ' +
        'iszero not add sub mul div exp mod addmod mulmod expmod ' +
        'byte sext twos bswap ' +
        'and or xor shift cmp lt le gt ge eq ne sha3 ' +
        'external contract define public ' +
        'call staticcall',
      'constant.language': 'true false void'
    }, 'text', true, ' ')

    this.$rules = {
      'start': [{
          token: 'meta.tag',
          regex: /[-a-zA-Z$\._0-9]+:/
        },
        {
          token: 'identifier',
          regex: /[%@]["-a-zA-Z$\._]["-a-zA-Z$\._0-9]*/
        },
        // Function declaration
        // I write it in two cases because one case doesn't work properly.
        {
          token: ['keyword', 'text', 'entity.name.function'],
          regex: /(define)(\s+)([%@]["-a-zA-Z$\._]["-a-zA-Z$\._0-9]*)\b/
        },
        {
          token: ['keyword', 'text', 'keyword', 'text', 'entity.name.function'],
          regex: /(define)(\s+)(public)(\s+)([%@]["-a-zA-Z$\._]["-a-zA-Z$\._0-9]*)\b/
        },
        {
          token: 'comment',
          regex: /\/\*/,
          next: 'blockComment'
        },
        {
          token: 'comment',
          regex: /\/\/.+$/
        },
        {
          token: 'paren.lparen',
          regex: '[\\[({]'
        },
        {
          token: 'paren.rparen',
          regex: '[\\])}]'
        },
        {
          token: 'constant.numeric',
          regex: '[+-]?(?:0[xbo])?\\d+\\b'
        },
        {
          token: 'variable.parameter',
          regex: /sy|pa?\d\d\d\d\|t\d\d\d\.|innnn/
        },
        {
          token: 'variable.parameter',
          regex: /\w+-\w+(?:-\w+)*/
        },
        {
          token: keywordMapper,
          regex: '\\b\\w+\\b'
        },
        {
          caseInsensitive: true
        }
      ],
      'blockComment': [{
          token: 'comment',
          regex: /\*\//,
          next: 'start'
        },
        {
          defaultToken: 'comment'
        }
      ]
    }
  }
  oop.inherits(IELEHighlightRules, TextHighlightRules)


  var Mode = function () {
    this.HighlightRules = IELEHighlightRules

    this.$outdent = new MatchingBraceOutdent()
    this.$behaviour = new CstyleBehaviour()
    this.foldingRules = new CStyleFoldMode()
    this.$id = 'ace/mode/iele'
  };
  oop.inherits(Mode, TextMode)

  exports.Mode = Mode
})