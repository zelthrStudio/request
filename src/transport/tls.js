'use strict'

const crypto = require('crypto')

const connectKeys = ['ca', 'rejectUnauthorized', 'cert', 'key', 'pfx', 'passphrase', 'ciphers', 'secureProtocol', 'secureOptions', 'checkServerIdentity', 'localAddress', 'family', 'lookup']

function connectOptions (self) {
  const options = {}
  for (const key of connectKeys) {
    if (self[key] !== undefined) {
      options[key] = self[key]
    }
  }
  return options
}

const fnIds = new WeakMap()
let nextFnId = 0

function fnId (fn) {
  let id = fnIds.get(fn)
  if (id === undefined) {
    id = ++nextFnId
    fnIds.set(fn, id)
  }
  return id
}

const bufferHashes = new WeakMap()

function hashValue (value) {
  if (Buffer.isBuffer(value)) {
    let hash = bufferHashes.get(value)
    if (hash === undefined) {
      hash = 'buf:' + value.length + ':' + crypto.createHash('sha256').update(value).digest('hex')
      bufferHashes.set(value, hash)
    }
    return hash
  }
  return 'str:' + crypto.createHash('sha256').update(String(value)).digest('hex')
}

function connectSignature (self, connect) {
  const keys = Object.keys(connect).sort()
  if (keys.length === 0) {
    return ''
  }
  const parts = []
  for (const key of keys) {
    let value = connect[key]
    if (typeof value === 'function') {
      value = 'fn:' + fnId(value)
    } else if (Array.isArray(value)) {
      value = 'arr:[' + value.map(hashValue).join(',') + ']'
    } else {
      value = hashValue(value)
    }
    parts.push(key + '=' + value)
  }
  return parts.join('&')
}

function stableValue (value) {
  if (typeof value === 'function') {
    return 'fn:' + fnId(value)
  }
  if (Buffer.isBuffer(value)) {
    return hashValue(value)
  }
  if (Array.isArray(value)) {
    return 'arr:[' + value.map(stableValue).join(',') + ']'
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return '{' + keys.map(function (key) {
      return key + '=' + stableValue(value[key])
    }).join(',') + '}'
  }
  return 'str:' + crypto.createHash('sha256').update(String(value)).digest('hex')
}

module.exports = { connectOptions, connectSignature, stableValue, fnId }
