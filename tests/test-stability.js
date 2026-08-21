'use strict'

// Regression tests for stability and performance fixes.

const { test } = require('node:test')
const assert = require('node:assert')
const stream = require('stream')
const request = require('../src')
const { createDnsCache } = require('../src/util').dnsCache
const { createServer, closeServer } = require('./server')

test('empty Buffer body sends content-length 0 instead of erroring', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('ok')
  })
  t.after(() => closeServer(server))

  const response = await request.promise({
    uri: 'http://127.0.0.1:' + server.port + '/',
    method: 'POST',
    body: Buffer.alloc(0)
  })
  assert.strictEqual(response.statusCode, 200)
})

test('case-insensitive header operations stay consistent', async function (t) {
  const server = await createServer(function (req, res) {
    res.end(req.headers['x-custom'] || 'missing')
  })
  t.after(() => closeServer(server))

  const req = request({
    uri: 'http://127.0.0.1:' + server.port + '/',
    headers: { 'X-Custom': 'first' }
  })

  // Overwrite with different casing must not duplicate the header.
  req.setHeader('x-custom', 'second')
  assert.strictEqual(req.getHeader('X-CUSTOM'), 'second')
  assert.strictEqual(req.hasHeader('x-Custom'), true)

  req.removeHeader('X-custom')
  assert.strictEqual(req.hasHeader('x-custom'), false)
  assert.strictEqual(req.getHeader('x-custom'), undefined)

  req.setHeader('X-Custom', 'third')
  const response = await req
  assert.strictEqual(response.body, 'third')
})

test('setHeader with an object merges without clobbering when merge=true', function () {
  const req = request({ uri: 'http://example.invalid/', headers: { a: '1' } })
  req.setHeader({ A: '2', b: '3' }, undefined, true)
  assert.strictEqual(req.getHeader('a'), '1')
  assert.strictEqual(req.getHeader('b'), '3')
})

test('streaming to a slow consumer delivers every byte (backpressure)', async function (t) {
  const total = 1024 * 1024
  const chunk = 'x'.repeat(64 * 1024)
  const server = await createServer(function (req, res) {
    res.setHeader('content-length', total)
    let written = 0
    const write = function () {
      while (written < total) {
        written += chunk.length
        if (!res.write(chunk)) {
          res.once('drain', write)
          return
        }
      }
      res.end()
    }
    write()
  })
  t.after(() => closeServer(server))

  let received = 0
  await new Promise(function (resolve, reject) {
    const sink = new stream.Writable({
      write (c, enc, cb) {
        received += c.length
        // Slow consumer: force the source to pause.
        setTimeout(cb, 1)
      }
    })
    const req = request('http://127.0.0.1:' + server.port + '/')
    req.pipe(sink)
    sink.on('finish', resolve)
    req.on('error', reject)
    sink.on('error', reject)
  })
  assert.strictEqual(received, total)
})

test('dns cache coalesces concurrent lookups into one resolution', async function (t) {
  const dns = require('dns')
  const original = dns.lookup
  let calls = 0
  dns.lookup = function () {
    calls++
    return original.apply(dns, arguments)
  }
  t.after(() => { dns.lookup = original })

  const cache = createDnsCache({ ttl: 60000 })
  t.after(() => cache.clear())

  // Three concurrent lookups for the same key must collapse into a single
  // underlying dns.lookup call.
  const results = await Promise.all([
    new Promise(function (resolve, reject) {
      cache('127.0.0.1', {}, function (err, address) {
        if (err) { reject(err) } else { resolve(address) }
      })
    }),
    new Promise(function (resolve, reject) {
      cache('127.0.0.1', {}, function (err, address) {
        if (err) { reject(err) } else { resolve(address) }
      })
    }),
    new Promise(function (resolve, reject) {
      cache('127.0.0.1', {}, function (err, address) {
        if (err) { reject(err) } else { resolve(address) }
      })
    })
  ])

  assert.deepStrictEqual(results, ['127.0.0.1', '127.0.0.1', '127.0.0.1'])
  assert.strictEqual(calls, 1, 'expected a single underlying dns.lookup, got ' + calls)
})

test('a throwing afterResponse hook rejects instead of hanging', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('boom')
  })
  t.after(() => closeServer(server))

  await assert.rejects(
    request.promise({
      uri: 'http://127.0.0.1:' + server.port + '/',
      hooks: {
        afterResponse: function () {
          throw new Error('hook exploded')
        }
      }
    }),
    /hook exploded/
  )
})

test('web: redirect location containing angle brackets is ignored', async function (t) {
  const webRequest = require('../src/web')
  const server = await createServer(function (req, res) {
    if (req.url === '/start') {
      res.statusCode = 302
      res.setHeader('location', 'http://evil.example/<>inject')
      res.end()
      return
    }
    res.end('final')
  })
  t.after(() => closeServer(server))

  const response = await webRequest.promise('http://127.0.0.1:' + server.port + '/start')
  // The invalid redirect is dropped, so the 302 response itself is returned.
  assert.strictEqual(response.statusCode, 302)
})
