'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const zlib = require('zlib')
const request = require('../src')
const { createServer, closeServer } = require('./server')

test('gzip: true decodes gzip responses', async function (t) {
  const server = await createServer(function (req, res) {
    const body = zlib.gzipSync('compressed content')
    res.setHeader('content-encoding', 'gzip')
    res.setHeader('content-length', body.length)
    res.end(body)
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      gzip: true
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 200)
        assert.strictEqual(body, 'compressed content')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('gzip: true sends accept-encoding header', async function (t) {
  let acceptEncoding = null
  const server = await createServer(function (req, res) {
    acceptEncoding = req.headers['accept-encoding']
    res.end('ok')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      gzip: true
    }, function (err, response) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 200)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
  assert.strictEqual(acceptEncoding, 'gzip, deflate')
})

test('without gzip option compressed body stays raw', async function (t) {
  const server = await createServer(function (req, res) {
    const body = zlib.gzipSync('raw gzip bytes')
    res.setHeader('content-encoding', 'gzip')
    res.end(body)
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      encoding: null
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 200)
        assert.ok(body instanceof Buffer)
        assert.notStrictEqual(body.toString(), 'raw gzip bytes')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('gzip stream mode decodes while piping', async function (t) {
  const server = await createServer(function (req, res) {
    res.setHeader('content-encoding', 'gzip')
    res.end(zlib.gzipSync('piped gzip data'))
  })
  t.after(() => closeServer(server))

  let data = ''
  await new Promise(function (resolve, reject) {
    const req = request({ uri: 'http://127.0.0.1:' + server.port + '/', gzip: true })
    req.on('data', function (chunk) {
      data += chunk
    })
    req.on('end', resolve)
    req.on('error', reject)
  })
  assert.strictEqual(data, 'piped gzip data')
})
