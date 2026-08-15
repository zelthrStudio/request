'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const request = require('../src')
const { createHttpsServer, closeServer, sslDir } = require('./server')

const ca = fs.readFileSync(path.join(sslDir, 'ca.crt'))

test('https request with rejectUnauthorized false', async function (t) {
  const server = await createHttpsServer(function (req, res) {
    res.end('secure hello')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'https://127.0.0.1:' + server.port + '/',
      rejectUnauthorized: false
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 200)
        assert.strictEqual(body, 'secure hello')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('https request verifies the ca chain', async function (t) {
  const server = await createHttpsServer(function (req, res) {
    res.end('verified')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'https://127.0.0.1:' + server.port + '/',
      ca,
      // The test cert has no SAN matching 127.0.0.1, so skip hostname checks.
      checkServerIdentity: function () { return undefined }
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, 'verified')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('https request with wrong ca fails', async function (t) {
  const server = await createHttpsServer(function (req, res) {
    res.end('should not arrive')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'https://127.0.0.1:' + server.port + '/',
      ca: '-----BEGIN CERTIFICATE-----\nZmFrZQ==\n-----END CERTIFICATE-----\n',
      checkServerIdentity: function () { return undefined }
    }, function (err) {
      try {
        assert.ok(err)
        assert.match(err.message, /self.signed|unable to verify|DEPTH_ZERO_SELF_SIGNED|UNABLE_TO_VERIFY/i)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('https post with json body', async function (t) {
  const server = await createHttpsServer(function (req, res) {
    let body = ''
    req.on('data', function (chunk) {
      body += chunk
    })
    req.on('end', function () {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ got: JSON.parse(body) }))
    })
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request.post({
      uri: 'https://127.0.0.1:' + server.port + '/',
      rejectUnauthorized: false,
      json: { hello: 'tls' }
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body.got.hello, 'tls')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})
