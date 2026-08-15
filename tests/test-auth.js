'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const request = require('../src')
const { createServer, closeServer } = require('./server')

test('basic auth is sent immediately', async function (t) {
  const server = await createServer(function (req, res) {
    res.end(req.headers.authorization || 'none')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      auth: { user: 'alice', pass: 'secret' }
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, 'Basic ' + Buffer.from('alice:secret').toString('base64'))
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('basic auth with username/password keys', async function (t) {
  const server = await createServer(function (req, res) {
    res.end(req.headers.authorization || 'none')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      auth: { username: 'bob', password: 'pw' }
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, 'Basic ' + Buffer.from('bob:pw').toString('base64'))
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('bearer auth is sent immediately', async function (t) {
  const server = await createServer(function (req, res) {
    res.end(req.headers.authorization || 'none')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      auth: { bearer: 'tok-123' }
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, 'Bearer tok-123')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('auth from uri userinfo', async function (t) {
  const server = await createServer(function (req, res) {
    res.end(req.headers.authorization || 'none')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request('http://carol:pass@127.0.0.1:' + server.port + '/', function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, 'Basic ' + Buffer.from('carol:pass').toString('base64'))
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('reauth on 401 challenge when sendImmediately is false', async function (t) {
  let attempts = 0
  const server = await createServer(function (req, res) {
    attempts++
    if (attempts === 1) {
      res.statusCode = 401
      res.setHeader('www-authenticate', 'Basic realm="test"')
      res.end('challenge')
    } else {
      res.end('authorized:' + req.headers.authorization)
    }
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      auth: { user: 'dave', pass: 'pw', sendImmediately: false }
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 200)
        assert.strictEqual(body, 'authorized:Basic ' + Buffer.from('dave:pw').toString('base64'))
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})
