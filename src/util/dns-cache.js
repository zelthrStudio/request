'use strict'

const dns = require('dns')

function createDnsCache (options) {
  options = options || {}
  const ttl = options.ttl === 0 ? 0 : (options.ttl || 30000)
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
    if (hit) {
      if ((Date.now() - hit.at) < ttl && hit.addresses.length > 0) {
        process.nextTick(function () {
          if (all) {
            cb(null, hit.addresses)
          } else {
            cb(null, hit.addresses[0].address, hit.addresses[0].family)
          }
        })
        return
      }
      entries.delete(key)
    }

    dns.lookup(hostname, { family, all: true }, function (err, addresses) {
      if (err) {
        cb(err)
        return
      }
      if (!addresses || addresses.length === 0) {
        const notFoundErr = new Error('getaddrinfo ENOTFOUND ' + hostname)
        notFoundErr.code = 'ENOTFOUND'
        cb(notFoundErr)
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

const defaultDnsCache = createDnsCache()

module.exports = { createDnsCache, defaultDnsCache }
