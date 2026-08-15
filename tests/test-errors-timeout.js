'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const request = require('../src')
const { createServer, closeServer } = require('./server')

test('timeout fires ETIMEDOUT error', async function (t) {
  const server = await createServer(function (req, res) {
    // Never respond.
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      timeout: 50
    }, function (err, response) {
      try {
        assert.ok(err)
        assert.strictEqual(err.code, 'ETIMEDOUT')
        assert.strictEqual(err.connect, true)
        assert.strictEqual(response, undefined)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('connection refused emits ECONNREFUSED', async function (t) {
  // Grab a port that nothing is listening on.
  const server = await createServer(function (req, res) {
    res.end()
  })
  const port = server.port
  await closeServer(server)

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + port + '/'
    }, function (err) {
      try {
        assert.ok(err)
        assert.strictEqual(err.code, 'ECONNREFUSED')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('error event fires for invalid URL', async function (t) {
  await new Promise(function (resolve, reject) {
    request({ uri: 'not a url' }, function (err) {
      try {
        assert.ok(err)
        assert.match(err.message, /Invalid URI/)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('error is emitted for invalid protocol', async function (t) {
  await new Promise(function (resolve, reject) {
    request({ uri: 'ftp://example.com/' }, function (err) {
      try {
        assert.ok(err)
        assert.match(err.message, /Invalid protocol/)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('abort during response stops body flow', async function (t) {
  const server = await createServer(function (req, res) {
    res.write('part one ')
    setTimeout(function () {
      res.end('part two')
    }, 30)
  })
  t.after(() => closeServer(server))

  let data = ''
  let aborted = false
  await new Promise(function (resolve) {
    const req = request('http://127.0.0.1:' + server.port + '/')
    req.on('data', function (chunk) {
      data += chunk
      req.abort()
    })
    req.on('abort', function () {
      aborted = true
      setTimeout(resolve, 20)
    })
    req.on('error', function () {})
    req.on('complete', function () {
      resolve()
    })
  })
  assert.ok(aborted)
  assert.strictEqual(data, 'part one ')
})
