'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const request = require('../src')
const { createServer, createHttp2Server, createHttpsHttp2Server, closeServer, readBody, sslDir } = require('./server')

function afterHttp2 (t, server) {
  t.after(async function () {
    await request.closePool()
    await closeServer(server)
  })
}

test('h2c GET over http2 resolves with the response', async function (t) {
  const server = await createHttp2Server(function (req, res) {
    res.setHeader('content-type', 'text/plain')
    res.end('hello over http2')
  })
  afterHttp2(t, server)

  const response = await request({ uri: 'http://127.0.0.1:' + server.port + '/', http2: true })
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(response.httpVersion, '2.0')
  assert.strictEqual(response.body, 'hello over http2')
})

test('http2 post with json body round-trips', async function (t) {
  const server = await createHttp2Server(function (req, res) {
    readBody(req).then(function (body) {
      assert.strictEqual(req.method, 'POST')
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ received: JSON.parse(body).msg }))
    })
  })
  afterHttp2(t, server)

  const response = await request.post({
    uri: 'http://127.0.0.1:' + server.port + '/',
    http2: true,
    json: { msg: 'pushed over h2' }
  })
  assert.strictEqual(response.body.received, 'pushed over h2')
})

test('http2 sends custom headers', async function (t) {
  const server = await createHttp2Server(function (req, res) {
    res.end(req.headers['x-custom'] || 'missing')
  })
  afterHttp2(t, server)

  const response = await request({
    uri: 'http://127.0.0.1:' + server.port + '/',
    http2: true,
    headers: { 'X-Custom': 'over-h2' }
  })
  assert.strictEqual(response.body, 'over-h2')
})

test('http2 streams a request body from a read stream', async function (t) {
  const server = await createHttp2Server(function (req, res) {
    readBody(req).then(function (body) {
      res.end(body)
    })
  })
  afterHttp2(t, server)

  const req = request.post({ uri: 'http://127.0.0.1:' + server.port + '/', http2: true })
  const src = new (require('stream').Readable)({
    read: function () {
      this.push('streamed body over http2')
      this.push(null)
    }
  })
  src.pipe(req)
  const response = await req
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(response.body, 'streamed body over http2')
})

test('http2 follows redirects', async function (t) {
  const server = await createHttp2Server(function (req, res) {
    if (req.url === '/start') {
      res.writeHead(302, { location: '/end' })
      res.end()
    } else {
      res.end('http2 redirected')
    }
  })
  afterHttp2(t, server)

  const response = await request({ uri: 'http://127.0.0.1:' + server.port + '/start', http2: true })
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(response.body, 'http2 redirected')
})

test('https request negotiates h2 via ALPN', async function (t) {
  const server = await createHttpsHttp2Server(function (req, res) {
    res.end('secure h2')
  })
  afterHttp2(t, server)

  const response = await request({
    uri: 'https://127.0.0.1:' + server.port + '/',
    http2: true,
    rejectUnauthorized: false
  })
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(response.body, 'secure h2')
})

test('https h2 verifies the ca chain', async function (t) {
  const server = await createHttpsHttp2Server(function (req, res) {
    res.end('verified h2')
  })
  afterHttp2(t, server)

  const response = await request({
    uri: 'https://127.0.0.1:' + server.port + '/',
    http2: true,
    ca: fs.readFileSync(path.join(sslDir, 'ca.crt'))
  })
  assert.strictEqual(response.body, 'verified h2')
})

test('http2 rejects when the server only speaks http/1.1', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('http1 only')
  })
  afterHttp2(t, server)

  await assert.rejects(
    request({ uri: 'http://127.0.0.1:' + server.port + '/', http2: true }),
    function (err) {
      assert.ok(err)
      return true
    }
  )
})

test('http2 respects the timeout option', async function (t) {
  const server = await createHttp2Server(function (req, res) {
    // Never respond.
  })
  afterHttp2(t, server)

  await assert.rejects(
    request({ uri: 'http://127.0.0.1:' + server.port + '/', http2: true, timeout: 50 }),
    function (err) {
      assert.strictEqual(err.code, 'ETIMEDOUT')
      return true
    }
  )
})
