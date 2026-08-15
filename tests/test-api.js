'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const request = require('../src')
const { createServer, closeServer, readBody } = require('./server')

test('basic GET returns statusCode and body', async function (t) {
  const server = await createServer(function (req, res) {
    res.setHeader('content-type', 'text/plain')
    res.end('hello world')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({ uri: 'http://127.0.0.1:' + server.port + '/', method: 'GET' }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 200)
        assert.strictEqual(body, 'hello world')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('request(url) shorthand works', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('ok')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request('http://127.0.0.1:' + server.port + '/', function (err, response) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 200)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('request.post convenience method', async function (t) {
  const server = await createServer(function (req, res) {
    readBody(req).then(function (body) {
      assert.strictEqual(req.method, 'POST')
      res.end(body)
    })
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request.post({ uri: 'http://127.0.0.1:' + server.port + '/', body: 'posted' }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 200)
        assert.strictEqual(body, 'posted')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('json request serializes and parses', async function (t) {
  const server = await createServer(function (req, res) {
    readBody(req).then(function (body) {
      assert.strictEqual(req.headers['content-type'], 'application/json')
      const data = JSON.parse(body)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ received: data, uppercase: data.msg.toUpperCase() }))
    })
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request.post({
      uri: 'http://127.0.0.1:' + server.port + '/',
      json: { msg: 'hello' }
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body.uppercase, 'HELLO')
        assert.strictEqual(body.received.msg, 'hello')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('qs option serializes query string', async function (t) {
  const server = await createServer(function (req, res) {
    res.end(req.url)
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/path',
      qs: { a: 1, b: 'two' }
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, '/path?a=1&b=two')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('custom headers are sent', async function (t) {
  const server = await createServer(function (req, res) {
    res.end(req.headers['x-custom'] || 'missing')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      headers: { 'X-Custom': 'value' }
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, 'value')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('encoding null returns a Buffer', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('buffer me')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      encoding: null
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.ok(Buffer.isBuffer(body))
        assert.strictEqual(body.toString(), 'buffer me')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('errors when uri is missing', async function (t) {
  await new Promise(function (resolve, reject) {
    request({ method: 'GET' }, function (err) {
      try {
        assert.ok(err)
        assert.match(err.message, /options\.uri is a required argument/)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('throws on undefined uri', function () {
  assert.throws(function () {
    request(undefined)
  }, /undefined is not a valid uri or options object/)
})

test('throws on HEAD with a body', function () {
  assert.throws(function () {
    request({ uri: 'http://example.com', method: 'HEAD', body: 'x' })
  }, /HTTP HEAD requests MUST NOT include a request body/)
})

test('response toJSON is serializable', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('json me')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request('http://127.0.0.1:' + server.port + '/', function (err, response, body) {
      try {
        assert.ifError(err)
        const json = JSON.parse(JSON.stringify(response))
        assert.strictEqual(json.statusCode, 200)
        assert.strictEqual(json.body, 'json me')
        assert.ok(json.request)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('events: request, response, complete are emitted', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('eventful')
  })
  t.after(() => closeServer(server))

  const events = []
  await new Promise(function (resolve, reject) {
    const req = request('http://127.0.0.1:' + server.port + '/')
    req.on('request', () => events.push('request'))
    req.on('response', () => events.push('response'))
    req.on('complete', function (response, body) {
      try {
        events.push('complete')
        // Without a callback the body is not collected, matching upstream
        // request semantics: the caller is expected to consume the stream.
        assert.strictEqual(response.statusCode, 200)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
  assert.deepStrictEqual(events, ['request', 'response', 'complete'])
})

test('abort emits abort and stops the request', async function (t) {
  const server = await createServer(function (req, res) {
    // Never respond.
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve) {
    const req = request('http://127.0.0.1:' + server.port + '/')
    req.on('abort', resolve)
    req.on('error', function () {})
    setTimeout(function () {
      req.abort()
    }, 20)
  })
})
