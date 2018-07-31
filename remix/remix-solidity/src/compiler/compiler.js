'use strict'

var solc = require('solc/wrapper')
var solcABI = require('solc/abi')

var webworkify = require('webworkify')

var compilerInput = require('./compiler-input')

var remixLib = require('remix-lib')
var EventManager = remixLib.EventManager

var txHelper = require('./txHelper')

const COMPILER_API_GATEWAY = 'https://staging.iele.dev-mantis.iohkdev.io/remix/api'
/*
  trigger compilationFinished, compilerLoaded, compilationStarted, compilationDuration
*/
function Compiler (handleImportCall) {
  var self = this
  this.event = new EventManager()

  var compileJSON

  var worker = null

  var currentVersion

  var optimize = false

  var compileToIELE = false

  this.setOptimize = function (_optimize) {
    optimize = _optimize
  }

  var compilationStartTime = null
  this.event.register('compilationFinished', (success, data, source) => {
    if (success && compilationStartTime) {
      this.event.trigger('compilationDuration', [(new Date().getTime()) - compilationStartTime])
    }
    compilationStartTime = null
  })

  this.event.register('compilationStarted', () => {
    compilationStartTime = new Date().getTime()
  })

  var internalCompile = function (files, target, missingInputs) {
    if (target.endsWith('.sol')) { // solidity 
      gatherImports(files, target, missingInputs, function (error, input) {
        if (error) {
          self.lastCompilationResult = null
          self.event.trigger('compilationFinished', [false, {'error': { formattedMessage: error, severity: 'error' }}, files])
        } else {
          compileJSON(input, optimize ? 1 : 0)
        }
      })
    } else { // iele 
      compileIELE(files, target)
    }
  }

  var compile = function (files, target, compileToIELE_) {
    compileToIELE = compileToIELE_
    self.event.trigger('compilationStarted', [])
    internalCompile(files, target)
  }
  this.compile = compile

  function setCompileJSON (_compileJSON) {
    compileJSON = _compileJSON
  }
  this.setCompileJSON = setCompileJSON // this is exposed for testing

  function onCompilerLoaded (version) {
    currentVersion = version
    self.event.trigger('compilerLoaded', [version])
  }

  /**
   * @rv: parse solidity error messages
   * Reference:
   * https://solidity.readthedocs.io/en/latest/using-the-compiler.html?highlight=error-types#error-types
   */
  function parseSolidityErrors(message) {
    message = message.trim().replace('Warning: This is a pre-release compiler version, please do not use it in production.', '')
    let end = message.indexOf('\n=====')
    if (end >= 0) {
      message = message.slice(0, end)
    }
    const starts = []
    const lines = message.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/^([^:]*):([0-9]*):(([0-9]*):)? /)) {
        starts.push(i)
      }
    }
    const messages = []
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i]
      const end = (i === starts.length - 1) ? lines.length : starts[i + 1]
      const t = []
      for (let j = start; j < end; j++) {
        t.push(lines[j])
      }
      messages.push(t.join('\n').trim())
    }
    return messages.map((message)=> {
      const errorMatch = message.match(/^[^:]*:[0-9]*:(?:[0-9]*:)?\s+([^:]+)\:\s+/)
      let isWarning = true
      if (errorMatch && errorMatch[1]) {
        const errorType = errorMatch[1]
        if (errorType.match(/error|exception/i)) {
          isWarning = false
        }
      }
      return {
        component: 'general',
        formattedMessage: message,
        severity: (isWarning ? 'warning' : 'error'),
        message
      }
    })
  }

  /**
   * @description Parse the IELE code
   * @param {string} ieleCode - The iele code
   * @param {string} optionalFilePath - which file this iele code belongs to. {optional}
   * @return {{[key:string]:{[key:string]:string}}}
   */
  function parseIELECode(ieleCode, optionalFilePath) {
    ieleCode = ieleCode.replace(/^IELE\s+assembly\s*\:\s*$/mgi, '')
    const sections = ieleCode.split(/^=+\s+([^=]+?)\s+=+\s/m).filter((x)=> x.trim().length)
    const output = {}
    function helper(ieleCode) {
      const lines = ieleCode.split('\n')
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]
        const match = line.match(/^\s*contract\s+/)
        if (match) {
          const contractName = line.replace('contract', '').trim().replace(/{$/, '').trim()
          let filePath
          if (contractName.match(/^"([^:]+?):([^"]+?)"$/) && !optionalFilePath) {
            filePath = contractName.match(/^"([^:]+?):([^"]+?)"$/)[1]
          } else {
            filePath = optionalFilePath
          }
          if (!(filePath in output)) {
            output[filePath] = {}
          }
          output[filePath][contractName] = ieleCode.trim()
          return
        }
      }
    }
    sections.forEach((ieleCode)=> helper(ieleCode))
    return output
  }

  /**
   * @param {string} code
   * @return {{[key:string]:{[key:string]:string}}}
   */
  function parseSolidityCodeAbi(code) {
    const lines = code.split('\n')
    const output = {}
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const match = line.match(/^\s*=+\s+(.+?)\s+=+$/)
      if (match) {
        const slug = match[1]
        const [filePath, contractName] = slug.split(':')
        if (!(filePath in output)) {
          output[filePath] = {}
        }
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim().startsWith('[')) {
            output[filePath][contractName] = JSON.parse(lines[j])
            i = j
            break
          }
        }
      }
    }
    return output
  }

  /**
   * @description compile IELE code
   * @param {string} ieleCode
   * @param {string} optionalFilePath - which file this iele code belongs to. {optional}
   * @return {{errors: any[], contracts: {[key:string]:{[key:string]: {assembly: string, bytecode: string, abi: object}}}}}
   */
  async function compileIELECode(ieleCode, optionalFilePath) {
    const parsed = parseIELECode(ieleCode, optionalFilePath)
    const contracts = {}
    let errors = []
    for (const filePath in parsed) {
      contracts[filePath] = {}
      const ieleFilePath = filePath.replace(/\.sol$/, '.iele')
      for (const contractName in parsed[filePath]) {
        const ieleCode = parsed[filePath][contractName]
        const response = await window['fetch'](COMPILER_API_GATEWAY, {
          method: 'POST',
          mode: 'cors',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            method: 'iele_asm',
            params: [ieleFilePath, {[ieleFilePath]: ieleCode}],
            jsonrpc: '2.0'
          })
        })
        const json = await response.json()
        if (json['error']) {
          const message = json['error']['data'].toString()
          errors.push({
            component: 'general',
            formattedMessage: message,
            severity: 'error',
            message
          })
        }
        const r = json['result']
        const bytecode = isNaN('0x' + r) ? '' : r
        const ieleAbi = retrieveIELEAbi(ieleCode, contractName)
        const ieleErrors = parseIeleErrors(r)
        if (ieleErrors && ieleErrors.length) {
          errors = errors.concat(ieleErrors)
        }
        contracts[filePath][contractName] = {
          assembly: ieleCode,
          bytecode: bytecode,
          abi: ieleAbi,
        }
      }
    }
    return {
      contracts,
      errors
    }
  }

  async function compileSolidityToIELE(result, source, cb) {
    const sources = source.sources
    const target = source.target
    delete result["errors"]
    delete result["error"]

    async function helper(sources, target) {
      // console.log('@compileSolidityToIELE', result, source)
      const params = [target, {}]
      for (const filePath in sources) {
        params[1][filePath] = sources[filePath].content
      }
      try {
        // get IELE assembly
        const response1 = await window['fetch'](COMPILER_API_GATEWAY, {
          method: 'POST',
          mode: 'cors',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            method: 'sol2iele_asm',
            params: params,
            jsonrpc: '2.0'
          })
        })
        const json1 = await response1.json()
        if (json1['error']) {
          throw json1['error']['data'].toString()
        }
  
        let code = json1['result']
        const index = code.indexOf('\n=====')         // TODO: multiple .sol files will produce multiple ====
        code = code.slice(index, code.length)
        const ieleCode = code.trim()
        let errors = parseSolidityErrors(json1['result'])

        if (!ieleCode) { // error. eg ballot.sol
          if (errors.length) {
            throw {
              errors: errors
            }
          } else {
            throw json1['result']
          }
        }

        // Compile IELE assembly
        const r = await compileIELECode(ieleCode)
        for (const filePath in r.contracts) {
          for (const contractNameSlug in r.contracts[filePath]) {
            const {assembly, bytecode, abi} = r.contracts[filePath][contractNameSlug]
            const contractName = contractNameSlug.replace(/"/g, '').split(':')[1]
            result.contracts[filePath][contractName] = {
              metadata: {
                vm: 'iele vm'
              },
              sourceLanguage: 'solidity',
              vm: 'ielevm',
              ielevm: {
                bytecode: {
                  object: bytecode
                },
                gasEstimate: {
                  codeDepositCost: '0',
                  executionCost: '0',
                  totalCost: '0'
                },
                abi,
                ieleAssembly: assembly
              },
            }
          }
        }
        errors = errors.concat(r.errors)
        if (errors.length) {
          result['errors'] = errors
        }

        // Get Solidity ABI 
        const response2 = await window['fetch'](COMPILER_API_GATEWAY, {
          method: 'POST',
          mode: 'cors',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            method: 'sol2iele_abi',
            params: params,
            jsonrpc: '2.0'
          })
        })
        const json2 = await response2.json()
        if (json2['error']) {
          throw json2['error']['data'].toString()
        }
        const abiMap = parseSolidityCodeAbi(json2['result'])
        for (const filePath in abiMap) {
          for (const contractName in abiMap[filePath]) {
            const abi = abiMap[filePath][contractName]
            result.contracts[filePath][contractName]['abi'] = abi
          }
        }

        // Get Solidity AST
        const response3 = await window['fetch'](COMPILER_API_GATEWAY, {
          method: 'POST',
          mode: 'cors',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            method: 'sol2iele_ast',
            params: params,
            jsonrpc: '2.0'
          })
        })
        const json3 = await response3.json()
        if (json3['error']) {
          throw json3['error']['data'].toString()
        }
        /*
        const abiMap = parseSolidityCodeAbi(json2['result'])
        for (const filePath in abiMap) {
          for (const contractName in abiMap[filePath]) {
            const abi = abiMap[filePath][contractName]
            result.contracts[filePath][contractName]['abi'] = abi
          }
        }
        */
      } catch(error) {
        throw error
      }
    }

    try {
      await helper(sources, target)
      return cb(result)
    } catch(error) {
      console.log(error)
      if (typeof(error) === 'string' ||
          (error.stack && error.message && typeof(error.stack) === 'string' && typeof(error.message) === 'string') // Exception
      ) {
        const message = error.toString()
        return cb({
          error: {
            component: 'general',
            formattedMessage: message,
            severity: 'error',
            message
          }
        })
      } else {
        return cb(error)
      }
    }
  }

  function parseIeleErrors(message) {
    if (isNaN('0x' + message)) {
      let start = 0
      let end = 0
      const lines = message.split('\n')
      return [{
        component: 'general',
        formattedMessage: message,
        severity: 'error',
        message: message,
      }]
    } else {
      return undefined
    }
  }

  async function compileIELE(sources, target) {
    try {
      const r = await compileIELECode(sources[target].content, target)
      const result = {contracts: {}, errors: r.errors}
      for (const filePath in r.contracts) {
        for (const contractName in r.contracts[filePath]) {
          const {abi, assembly, bytecode} = r.contracts[filePath][contractName]
          if (!(filePath in result.contracts)) {
            result.contracts[filePath] = {}
          }
          result.contracts[filePath][contractName] = {
            abi,
            metadata: {
              vm: 'iele vm'
            },
            ielevm: {
              bytecode: {
                object: bytecode
              },
              gasEstimate: {
                codeDepositCost: '0',
                executionCost: '0',
                totalCost: '0'
              },
              abi
            },
            sourceLanguage: 'iele',
            vm: 'ielevm'
          }
        }
      }
      return compilationFinished(result, undefined, {sources, target})
    } catch(error) {
      if (typeof(error) === 'string' ||
          (error.stack && error.message && typeof(error.stack) === 'string' && typeof(error.message) === 'string') // Exception
      ) {
        const message = error.toString()
        return compilationFinished({
          error: {
            component: 'general',
            formattedMessage: message,
            severity: 'error',
            message
          }
        }, undefined, {sources, target})
      } else {
        return compilationFinished(error, undefined, {sources, target})
      }
    }
  }

  /**
   * @rv: get ABI from IELE code.
   * @param {string} ieleCode
   * @param {string} contractName
   * @return {object[]}
   */
  function retrieveIELEAbi(ieleCode, contractName) {
    // TODO: check if contractName is empty
    if (!contractName || !ieleCode) {
      return []
    }
    let match = ieleCode.match(new RegExp(`contract\\s+${contractName}\\s+{`))
    if (!match) {
      return []
    }
    const index = match.index
    ieleCode = ieleCode.slice(index, ieleCode.length)

    // remove comments
    ieleCode = ieleCode.replace(/\/\/.+?$/mg, '') // line comment
    ieleCode = ieleCode.replace(/[^\\]\/\*([\w\W]+?)\*\//g, '') // block comment

    let paren = 0
    let i = 0
    for (i = 0; i < ieleCode.length; i++) {
      if (ieleCode[i] === '{') {
        paren++
      } else if (ieleCode[i] === '}') {
        paren--
        if (paren === 0) {
          break
        }
      }
    }
    if (paren !== 0) { // curly brackets don't match
      return []
    }
    ieleCode = ieleCode.slice(0, i + 1)

    // analyze functions
    const regex = /\sdefine\s+(public\s+)*\@([\w\W]+?)\(([^)]*?)\)\s*\{/g
    const abiArray = []
    match = null
    while ((match = regex.exec(ieleCode)) !== null) {
      const public_ = (match[1] || '').trim()
      const functionName = match[2].trim().replace(/^"/, '').replace(/"$/, '')
      if (!public_ && functionName !== 'init') { // ignore private functions excluding @init
        continue
      }
      const parameters = match[3].split(',').map((x)=> x.trim()).filter(x=>x)
      const type = (functionName === 'init') ? 'constructor' : 'function'
      abiArray.push({
        name: functionName,
        inputs: parameters.map((parameter)=> {
          return {
            name: parameter,
            type: 'int'
          }
        }),
        type
      })
    }
    return abiArray
  }

  function onInternalCompilerLoaded () {
    if (worker === null) {
      compileJSON = async function (source, optimize, cb) {
        const contracts = {}
        const sources = {}
        for (const filePath in source.sources) {
          contracts[filePath] = {}
          sources[filePath] = {}
        }
        const result = {
          contracts: contracts,
          sources: {}
        }

        if (compileToIELE) {
          return compileSolidityToIELE(result, source, (result)=> {
            console.log('Compiled result: ', result)
            return compilationFinished(result, [], source)
          })
        }

        // console.log('@compilationFinished: ', result)
        compilationFinished(result, missingInputs, source)
      }
      onCompilerLoaded('isolc')
    }
  }
  // exposed for use in node
  this.onInternalCompilerLoaded = onInternalCompilerLoaded

  this.lastCompilationResult = {
    data: null,
    source: null
  }

  /**
    * return the contract obj of the given @arg name. Uses last compilation result.
    * return null if not found
    * @param {String} name    - contract name
    * @returns contract obj and associated file: { contract, file } or null
    */
  this.getContract = (name) => {
    if (this.lastCompilationResult.data && this.lastCompilationResult.data.contracts) {
      return txHelper.getContract(name, this.lastCompilationResult.data.contracts)
    }
    return null
  }

  /**
    * call the given @arg cb (function) for all the contracts. Uses last compilation result
    * @param {Function} cb    - callback
    */
  this.visitContracts = (cb) => {
    if (this.lastCompilationResult.data && this.lastCompilationResult.data.contracts) {
      return txHelper.visitContracts(this.lastCompilationResult.data.contracts, cb)
    }
    return null
  }

  /**
    * return the compiled contracts from the last compilation result
    * @return {Object}     - contracts
    */
  this.getContracts = () => {
    if (this.lastCompilationResult.data && this.lastCompilationResult.data.contracts) {
      return this.lastCompilationResult.data.contracts
    }
    return null
  }

   /**
    * return the sources from the last compilation result
    * @param {Object} cb    - map of sources
    */
  this.getSources = () => {
    if (this.lastCompilationResult.source) {
      return this.lastCompilationResult.source.sources
    }
    return null
  }

  /**
    * return the sources @arg fileName from the last compilation result
    * @param {Object} cb    - map of sources
    */
  this.getSource = (fileName) => {
    if (this.lastCompilationResult.source) {
      return this.lastCompilationResult.source.sources[fileName]
    }
    return null
  }

  /**
    * return the source from the last compilation result that has the given index. null if source not found
    * @param {Int} index    - index of the source
    */
  this.getSourceName = (index) => {
    if (this.lastCompilationResult.data && this.lastCompilationResult.data.sources) {
      return Object.keys(this.lastCompilationResult.data.sources)[index]
    }
    return null
  }

  function compilationFinished (data, missingInputs, source) {
    // console.log('@compilationFinished: ', data)
    var noFatalErrors = true // ie warnings are ok

    function isValidError (error) {
      // The deferred import is not a real error
      // FIXME: maybe have a better check?
      if (/Deferred import/.exec(error.message)) {
        return false
      }

      return error.severity !== 'warning'
    }

    if (data['error'] !== undefined) {
      // Ignore warnings (and the 'Deferred import' error as those are generated by us as a workaround
      if (isValidError(data['error'])) {
        noFatalErrors = false
      }
    }
    if (data['errors'] !== undefined) {
      data['errors'].forEach(function (err) {
        // Ignore warnings and the 'Deferred import' error as those are generated by us as a workaround
        if (isValidError(err)) {
          noFatalErrors = false
        }
      })
    }

    if (!noFatalErrors) {
      // There are fatal errors - abort here
      self.lastCompilationResult = null
      self.event.trigger('compilationFinished', [false, data, source])
    } else if (missingInputs !== undefined && missingInputs.length > 0) {
      // try compiling again with the new set of inputs
      internalCompile(source.sources, source.target, missingInputs)
    } else {
      /*
      // @rv: this is disabled
      if (source.target.endsWith('.sol')) {
        data = updateInterface(data)
      }
      */
      self.lastCompilationResult = {
        data: data,
        source: source
      }
      self.event.trigger('compilationFinished', [true, data, source])
    }
  }

  // TODO: needs to be changed to be more node friendly
  this.loadVersion = function (usingWorker, url) {
    self.event.trigger('loadingCompiler', [url, usingWorker])

    if (usingWorker) {
      loadWorker(url)
    } else {
      loadInternal(url)
    }
  }

  function loadInternal (url) {
    delete window.Module
    // NOTE: workaround some browsers?
    window.Module = undefined

    // Set a safe fallback until the new one is loaded
    setCompileJSON(function (source, optimize) {
      compilationFinished({ error: { formattedMessage: 'Compiler not yet loaded.' } })
    })

    var newScript = document.createElement('script')
    newScript.type = 'text/javascript'
    newScript.src = url
    document.getElementsByTagName('head')[0].appendChild(newScript)
    newScript.onload = function() { // @rv: sol.js loaded
      onInternalCompilerLoaded();
    }
  }

  function loadWorker (url) {
    if (worker !== null) {
      worker.terminate()
    }
    worker = webworkify(require('./compiler-worker.js'))
    var jobs = []
    worker.addEventListener('message', function (msg) {
      var data = msg.data
      switch (data.cmd) {
        case 'versionLoaded':
          onCompilerLoaded(data.data)
          break
        case 'compiled':
          var result
          try {
            result = JSON.parse(data.data)
          } catch (exception) {
            result = { 'error': 'Invalid JSON output from the compiler: ' + exception }
          }
          var sources = {}
          if (data.job in jobs !== undefined) {
            sources = jobs[data.job].sources
            delete jobs[data.job]
          }
          compilationFinished(result, data.missingInputs, sources)
          break
      }
    })
    worker.onerror = function (msg) {
      compilationFinished({ error: 'Worker error: ' + msg.data })
    }
    worker.addEventListener('error', function (msg) {
      compilationFinished({ error: 'Worker error: ' + msg.data })
    })
    compileJSON = function (source, optimize) {
      jobs.push({sources: source})
      worker.postMessage({cmd: 'compile', job: jobs.length - 1, input: compilerInput(source.sources, {optimize: optimize, target: source.target})})
    }
    worker.postMessage({cmd: 'loadVersion', data: url})
  }

  function gatherImports (files, target, importHints, cb) {
    // console.log('@gatherImports')
    // console.log('* files: ', files)
    // console.log('* target: ', target)
    // console.log('* importHints: ', importHints)
    importHints = importHints || []

    // FIXME: This will only match imports if the file begins with one.
    //        It should tokenize by lines and check each.
    // eslint-disable-next-line no-useless-escape
    // var importRegex = /^\s*import\s*[\'\"]([^\'\"]+)[\'\"];/g  // @rv: This regexp is wrong

    for (const fileName in files) {
      const lines = files[fileName].content.split('\n')
      lines.forEach((line, index)=> {
        const match = line.match(/^\s*import\s*[\'\"]([^\'\"]+)[\'\"]\s*;/)
        if (match) {
          let importFilePath = match[1]
          if (importFilePath.startsWith('./')) {
            const path = /(.*\/).*/.exec(target)
            if (path !== null) {
              importFilePath = importFilePath.replace('./', path[1])
            } else {
              importFilePath = importFilePath.slice(2)
            }
          }
  
          // FIXME: should be using includes or sets, but there's also browser compatibility..
          if (importHints.indexOf(importFilePath) === -1) {
            importHints.push(importFilePath)
          }
        }
      }) 
    }

    while (importHints.length > 0) {
      var m = importHints.pop()
      if (m in files) {
        continue
      }

      if (handleImportCall) {
        handleImportCall(m, function (err, content) {
          if (err) {
            cb(err)
          } else {
            files[m] = { content }
            gatherImports(files, target, importHints, cb)
          }
        })
      }

      return
    }

    cb(null, { 'sources': files, 'target': target })
  }

  function truncateVersion (version) {
    var tmp = /^(\d+.\d+.\d+)/.exec(version)
    if (tmp) {
      return tmp[1]
    }
    return version
  }

  function updateInterface (data) {
    txHelper.visitContracts(data.contracts, (contract) => {
      data.contracts[contract.file][contract.name].abi = solcABI.update(truncateVersion(currentVersion), contract.object.abi)
    })
    return data
  }
}

module.exports = Compiler
