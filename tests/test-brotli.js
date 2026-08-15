'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const zlib = require('zlib')
const request = require('../src')
const { createServer, closeServer } = require('./server')

test('brotli: true decodes brotli responses', async function (t) {
  const server = await createServer(function (req, res) {
    const body = zlib.brotliCompressSync('brotli payload')
    res.setHeader('content-encoding', 'br')
    res.setHeader('content-length', body.length)
    res.end(body)
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      gzip: true,
      brotli: true
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 200)
        assert.strictEqual(body, 'brotli payload')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('brotli: true advertises br in accept-encoding', async function (t) {
  let acceptEncoding = null
  const server = await createServer(function (req, res) {
    acceptEncoding = req.headers['accept-encoding']
    res.end('ok')
  })
  t.after(() => closeServer(server))

  await request.promise({ uri: 'http://127.0.0.1:' + server.port + '/', gzip: true, brotli: true })
  assert.strictEqual(acceptEncoding, 'gzip, deflate, br')
})

test('without brotli option br responses stay raw', async function (t) {
  const server = await createServer(function (req, res) {
    res.setHeader('content-encoding', 'br')
    res.end(zlib.brotliCompressSync('raw br bytes'))
  })
  t.after(() => closeServer(server))

  const response = await request.promise({
    uri: 'http://127.0.0.1:' + server.port + '/',
    gzip: true,
    encoding: null
  })
  assert.strictEqual(response.statusCode, 200)
  assert.ok(response.body instanceof Buffer)
  assert.notStrictEqual(response.body.toString(), 'raw br bytes')
})
