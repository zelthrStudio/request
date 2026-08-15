'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const request = require('../src')
const { createServer, closeServer, readBody } = require('./server')

test('await request resolves with the response and body', async function (t) {
  const server = await createServer(function (req, res) {
    res.setHeader('content-type', 'text/plain')
    res.end('hello from promise land')
  })
  t.after(() => closeServer(server))

  const response = await request('http://127.0.0.1:' + server.port + '/')
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(response.body, 'hello from promise land')
})

test('await with json parses the response body', async function (t) {
  const server = await createServer(function (req, res) {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, n: 42 }))
  })
  t.after(() => closeServer(server))

  const response = await request({ uri: 'http://127.0.0.1:' + server.port + '/', json: true })
  assert.strictEqual(response.statusCode, 200)
  assert.deepStrictEqual(response.body, { ok: true, n: 42 })
})

test('await post sends a body', async function (t) {
  const server = await createServer(function (req, res) {
    readBody(req).then(function (body) {
      res.end(body)
    })
  })
  t.after(() => closeServer(server))

  const response = await request.post({
    uri: 'http://127.0.0.1:' + server.port + '/',
    json: { msg: 'posted' }
  })
  assert.strictEqual(response.body.msg, 'posted')
})

test('.then/.catch chaining works', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('chained')
  })
  t.after(() => closeServer(server))

  const body = await request('http://127.0.0.1:' + server.port + '/')
    .then(function (response) {
      return response.body
    })
  assert.strictEqual(body, 'chained')
})

test('await rejects on connection errors', async function (t) {
  const server = await createServer(function () {})
  const port = server.port
  await closeServer(server)

  await assert.rejects(
    request('http://127.0.0.1:' + port + '/'),
    function (err) {
      assert.strictEqual(err.code, 'ECONNREFUSED')
      return true
    }
  )
})

test('.catch catches request errors', async function (t) {
  const server = await createServer(function () {})
  const port = server.port
  await closeServer(server)

  const err = await request('http://127.0.0.1:' + port + '/').catch(function (e) {
    return e
  })
  assert.strictEqual(err.code, 'ECONNREFUSED')
})

test('await rejects when the request is aborted', async function (t) {
  const server = await createServer(function (req, res) {
    // Never respond.
  })
  t.after(() => closeServer(server))

  const req = request('http://127.0.0.1:' + server.port + '/')
  const pending = req.then(
    function () {
      return assert.fail('should not resolve')
    },
    function (err) {
      assert.match(err.message, /aborted/i)
    }
  )
  setTimeout(function () {
    req.abort()
  }, 20)
  await pending
})

test('.finally runs after resolution', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('finally')
  })
  t.after(() => closeServer(server))

  let ran = false
  const response = await request('http://127.0.0.1:' + server.port + '/').finally(function () {
    ran = true
  })
  assert.strictEqual(response.body, 'finally')
  assert.strictEqual(ran, true)
})

test('await still works when the request is piped', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('piped and awaited')
  })
  t.after(() => closeServer(server))

  const chunks = []
  const sink = new (require('stream').Writable)({
    write: function (chunk, enc, cb) {
      chunks.push(chunk)
      cb()
    }
  })
  const req = request('http://127.0.0.1:' + server.port + '/')
  req.pipe(sink)
  const response = await req
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(Buffer.concat(chunks).toString(), 'piped and awaited')
})

test('awaiting an already completed request resolves immediately', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('done')
  })
  t.after(() => closeServer(server))

  const req = request('http://127.0.0.1:' + server.port + '/')
  const first = await req
  assert.strictEqual(first.statusCode, 200)
  const second = await req
  assert.strictEqual(second.statusCode, 200)
})
