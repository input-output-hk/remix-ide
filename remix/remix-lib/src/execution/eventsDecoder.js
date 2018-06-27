'use strict'
var ethJSUtil = require('ethereumjs-util')
var ethers = require('ethers')
var txHelper = require('./txHelper')
const ieleTranslator = require('./ieleTranslator')

/**
  * Register to txListener and extract events
  *
  */
class EventsDecoder {
  constructor (opt = {}) {
    this._api = opt.api
  }

/**
  * use Transaction Receipt to decode logs. assume that the transaction as already been resolved by txListener.
  * logs are decoded only if the contract if known by remix.
  *
  * @param {Object} tx - transaction object
  * @param {Function} cb - callback
  */
  parseLogs (tx, contractName, compiledContracts, cb) {
    if (tx.isCall) return cb(null, { decoded: [], raw: [] })
    this._api.resolveReceipt(tx, (error, receipt) => {
      if (error) return cb(error)
      this._decodeLogs(tx, receipt, contractName, compiledContracts, cb)
    })
  }

  _decodeLogs (tx, receipt, contract, contracts, cb) {
    if (!contract || !receipt) {
      return cb('cannot decode logs - contract or receipt not resolved ')
    }
    if (!receipt.logs) {
      return cb(null, { decoded: [], raw: [] })
    }
    // console.log('@eventsDecoder.js _decodeLogs')
    // console.log('* tx: ', tx)
    // console.log('* receipt: ', receipt)
    // console.log('* contract: ', contract)
    // console.log('* contracts: ', contracts)

    this._decodeEvents(tx, receipt.logs, contract, contracts, cb)
  }

  _eventABI (contract) {
    // TODO: @rv: support event log for IELE language
    // console.log('@eventsDecoder.js _eventABI')
    // console.log('* contract: ', contract)
    if (contract.sourceLanguage === 'iele') {
       return {}
    }
    
    var eventABI = {}
    var abi = new ethers.Interface(contract.abi)
    for (var e in abi.events) {
      var event = abi.events[e]
      eventABI[ethJSUtil.sha3(new Buffer(event.signature)).toString('hex')] = { 
        event: event.name, 
        inputs: event.inputs, 
        object: event, 
        vm: contract.vm,  // @rv
        sourceLanguage: contract.sourceLanguage 
      }
    }
    return eventABI
  }

  _eventsABI (compiledContracts) {
    var eventsABI = {}
    txHelper.visitContracts(compiledContracts, (contract) => {
      eventsABI[contract.name] = this._eventABI(contract.object)
    })
    return eventsABI
  }

  _event (hash, eventsABI) {
    for (var k in eventsABI) {
      if (eventsABI[k][hash]) {
        return eventsABI[k][hash]
      }
    }
    return null
  }

  _decodeEvents (tx, logs, contractName, compiledContracts, cb) {
    // console.log('@eventsDecoder.js _decodeEvents')
    var eventsABI = this._eventsABI(compiledContracts)
    // console.log('* eventsABI: ', eventsABI)
    var events = []
    for (var i in logs) {
      // [address, topics, mem]
      var log = logs[i]
      var topicId = log.topics[0]
      var abi = this._event(topicId.replace('0x', ''), eventsABI)
      if (abi) {
        // console.log('* i: ', i)
        // console.log('* abi: ', abi)
        // console.log('* log: ', log)
        if (abi.vm === 'ielevm') {
          if (abi.sourceLanguage === 'solidity') {
            let data = log.data.replace(/^0x/, '')
            if (data.length %2 !== 0) { data = '0' + data }
            let flippedData = ''
            // flip data
            for (let i = 0; i < data.length; i += 2) {
              flippedData = data[i] + data[i + 1] + flippedData
            }
            let type = null
            if (abi.inputs.types.length > 1) {
              type = {
                type: 'tuple',
                components: abi.inputs.types.map((t)=> {return {type: t}})
              }
            } else if (abi.inputs.types.length === 1) {
              type = {
                type: abi.inputs.types[0]
              }
            }
            console.log('- flippedData: ', flippedData)
            console.log('- type: ', type)
            if (type) {
              const stringResult = ieleTranslator.decode(flippedData, type).stringResult
              console.log('- stringResult: ', stringResult)
              events.push({ from: log.address, topic: topicId, event: abi.event, args: stringResult })
            }
          } 
          // else {
          //   events.push({ from: log.address, topic: topicId, event: abi.event, data: log.data})
          // }
        } else { // evm & solidity
          events.push({ from: log.address, topic: topicId, event: abi.event, args: abi.object.parse(log.topics, log.data) })
        }
      } else {
        events.push({ from: log.address, data: log.data, topics: log.topics })
      }
    }
    cb(null, { decoded: events, raw: logs })
  }
}

module.exports = EventsDecoder
