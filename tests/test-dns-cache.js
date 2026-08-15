'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const request = require('../src')
const { createDnsCache, defaultDnsCache } = require('../src/util').dnsCache
const { createServer, closeServer } = require('./server')

test('createDnsCache resolves and caches lookups', async function (t) {
  const cache = createDnsCache({ ttl: 60000 })
  t.after(() => cache.clear())

  const lookup = function (hostname) {
    return new Promise(function (resolve, reject) {
      cache(hostname, {}, function (err, address, family) {
        if (err) {
          reject(err)
        } else {
          resolve({ address, family })
        }
      })
    })
  }

  const first = await lookup('127.0.0.1')
  const second = await lookup('127.0.0.1')
  assert.strictEqual(first.address, '127.0.0.1')
  assert.strictEqual(second.address, '127.0.0.1')
  assert.strictEqual(cache.size(), 1)
})

test('createDnsCache all: true returns the full address array', async function (t) {
  const cache = createDnsCache({ ttl: 60000 })
  t.after(() => cache.clear())

  const addresses = await new Promise(function (resolve, reject) {
    cache('127.0.0.1', { all: true }, function (err, result) {
      if (err) {
        reject(err)
      } else {
        resolve(result)
      }
    })
  })
  assert.ok(Array.isArray(addresses))
  assert.ok(addresses.length > 0)
  assert.strictEqual(addresses[0].address, '127.0.0.1')
})

test('dnsCache: true works end-to-end', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('dns cached')
  })
  t.after(() => closeServer(server))
  t.after(() => defaultDnsCache.clear())

  const response = await request.promise({
    uri: 'http://127.0.0.1:' + server.port + '/',
    dnsCache: true
  })
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(response.body, 'dns cached')
})

test('custom lookup function is used by the transport', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('custom lookup')
  })
  t.after(() => closeServer(server))

  let lookups = 0
  const response = await request.promise({
    uri: 'http://custom.invalid:' + server.port + '/',
    headers: { host: 'custom.invalid' },
    lookup: function (hostname, opts, cb) {
      if (typeof opts === 'function') {
        cb = opts
        opts = {}
      }
      lookups++
      if (opts.all) {
        cb(null, [{ address: '127.0.0.1', family: 4 }])
      } else {
        cb(null, '127.0.0.1', 4)
      }
    }
  })
  assert.strictEqual(response.body, 'custom lookup')
  assert.ok(lookups > 0)
})
