'use strict'

// Modified by zelthrStudio (2026) from the original `request` package
// (Copyright 2010-2012 Mikeal Rogers, Apache License 2.0).

const crypto = require('crypto')

function defer (fn) {
  return typeof setImmediate === 'function' ? setImmediate(fn) : process.nextTick(fn)
}

function isPlainObject (obj) {
  return obj !== null && typeof obj === 'object' && obj.constructor === Object
}

// Shallow or deep extend. Pass `true` as the first argument for a deep merge.
function extend (obj, ...rest) {
  let deep = false
  if (typeof obj === 'boolean') {
    deep = obj
    obj = rest.shift()
  }
  const target = obj
  for (const source of rest) {
    if (!source || typeof source !== 'object') {
      continue
    }
    for (const key of Object.keys(source)) {
      const value = source[key]
      if (deep && isPlainObject(value)) {
        if (!isPlainObject(target[key])) {
          target[key] = {}
        }
        extend(true, target[key], value)
      } else {
        target[key] = value
      }
    }
  }
  return target
}

function copy (obj) {
  const o = {}
  for (const key of Object.keys(obj)) {
    o[key] = obj[key]
  }
  return o
}

function paramsHaveRequestBody (params) {
  return Boolean(
    params.body ||
    params.requestBodyStream ||
    (params.json && typeof params.json !== 'boolean') ||
    params.multipart
  )
}

// JSON.stringify that does not blow up on circular references.
function safeStringify (obj, replacer) {
  const seen = new WeakSet()
  return JSON.stringify(obj, function (key, value) {
    if (typeof replacer === 'function') {
      value = replacer(key, value)
    }
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]'
      }
      seen.add(value)
    }
    return value
  })
}

function md5 (str) {
  return crypto.createHash('md5').update(str).digest('hex')
}

function isReadStream (rs) {
  return Boolean(rs && rs.readable && rs.path && rs.mode)
}

function isstream (obj) {
  return obj !== null && typeof obj === 'object' && typeof obj.pipe === 'function'
}

function toBase64 (str) {
  return Buffer.from(str || '', 'utf8').toString('base64')
}

// Case-insensitive header helpers over a plain headers object.
function caseless (dict) {
  const lower = {}
  for (const key of Object.keys(dict)) {
    lower[key.toLowerCase()] = key
  }
  return {
    get (name) {
      const key = lower[name.toLowerCase()]
      return key === undefined ? undefined : dict[key]
    },
    has (name) {
      return Object.prototype.hasOwnProperty.call(lower, name.toLowerCase())
    },
    set (name, value) {
      dict[lower[name.toLowerCase()] || name] = value
    },
    remove (name) {
      const key = lower[name.toLowerCase()]
      if (key !== undefined) {
        delete dict[key]
        delete lower[name.toLowerCase()]
      }
    },
    dict
  }
}

exports.defer = defer
exports.isPlainObject = isPlainObject
exports.extend = extend
exports.copy = copy
exports.paramsHaveRequestBody = paramsHaveRequestBody
exports.safeStringify = safeStringify
exports.md5 = md5
exports.isReadStream = isReadStream
exports.isstream = isstream
exports.toBase64 = toBase64
exports.caseless = caseless
