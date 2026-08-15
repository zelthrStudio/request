'use strict'

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

// TLS/socket options shared between the connection pool (agents keyed by
// these) and the HTTP/2 session pool.

const crypto = require('crypto')

// `lookup` is part of the key so a custom DNS resolver (DNS pinning, SSRF
// guards) is never silently bypassed by reusing a socket pooled by a request
// without it.
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

// Stable ids for function-valued options (checkServerIdentity, lookup): two
// distinct functions with the same arity must not collapse to the same pool
// key.
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

function hashValue (value) {
  if (Buffer.isBuffer(value)) {
    // Hash the full buffer: a 32-byte truncation of a hex digest would let
    // different CAs with a shared prefix reuse an agent.
    return 'buf:' + value.length + ':' + crypto.createHash('sha256').update(value).digest('hex')
  }
  return 'str:' + crypto.createHash('sha256').update(String(value)).digest('hex')
}

// A stable string that identifies a unique set of connect options, so pools
// can be keyed per TLS configuration (ca, client certs, ...) without those
// settings leaking between requests.
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

module.exports = { connectOptions, connectSignature, fnId }
