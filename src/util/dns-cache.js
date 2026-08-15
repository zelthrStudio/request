'use strict'

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

const dns = require('dns')

// A `lookup` function (compatible with net.connect / http.request) that
// caches dns.lookup results for `ttl` milliseconds. The cache is keyed by
// hostname + address family so IPv4/IPv6 lookups do not poison each other.
function createDnsCache (options) {
  options = options || {}
  const ttl = options.ttl || 30000
  const max = options.max || 1000
  const entries = new Map()

  function lookup (hostname, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    const family = opts.family || 0
    const all = !!opts.all
    const key = hostname + '|' + family + '|' + (all ? 'a' : 'f')
    const hit = entries.get(key)
    if (hit && (Date.now() - hit.at) < ttl) {
      process.nextTick(function () {
        if (all) {
          cb(null, hit.addresses)
        } else {
          cb(null, hit.addresses[0].address, hit.addresses[0].family)
        }
      })
      return
    }

    dns.lookup(hostname, { family, all: true }, function (err, addresses) {
      if (err) {
        cb(err)
        return
      }
      entries.set(key, { at: Date.now(), addresses })
      if (entries.size > max) {
        entries.delete(entries.keys().next().value)
      }
      if (all) {
        cb(null, addresses)
      } else {
        cb(null, addresses[0].address, addresses[0].family)
      }
    })
  }

  lookup.clear = function () {
    entries.clear()
  }
  lookup.size = function () {
    return entries.size
  }
  return lookup
}

// Shared instance used by `dnsCache: true`. Exposed as request.cache of the
// DNS layer so tests and apps can clear it.
const defaultDnsCache = createDnsCache()

module.exports = { createDnsCache, defaultDnsCache }
