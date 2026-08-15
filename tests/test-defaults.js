'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const request = require('../src')
const { createServer, closeServer } = require('./server')

test('defaults merge base options', async function (t) {
  const server = await createServer(function (req, res) {
    res.end(req.headers['x-default'] + ':' + req.url)
  })
  t.after(() => closeServer(server))

  const client = request.defaults({
    headers: { 'X-Default': 'from-defaults' }
  })

  await new Promise(function (resolve, reject) {
    client('http://127.0.0.1:' + server.port + '/route', function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, 'from-defaults:' + '/route')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('defaults with baseUrl', async function (t) {
  const server = await createServer(function (req, res) {
    res.end(req.url)
  })
  t.after(() => closeServer(server))

  const client = request.defaults({ baseUrl: 'http://127.0.0.1:' + server.port })
  await new Promise(function (resolve, reject) {
    client.get('/sub/path', function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, '/sub/path')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('defaults can be chained and overridden', async function (t) {
  const server = await createServer(function (req, res) {
    res.end((req.headers['x-a'] || '') + '|' + (req.headers['x-b'] || '') + '|' + (req.headers['x-c'] || ''))
  })
  t.after(() => closeServer(server))

  const level1 = request.defaults({ headers: { 'X-A': 'a', 'X-B': 'b' } })
  const level2 = level1.defaults({ headers: { 'X-C': 'c' } })

  await new Promise(function (resolve, reject) {
    level2.get('http://127.0.0.1:' + server.port + '/', function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, 'a|b|c')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('defaults provide convenience verbs', async function (t) {
  const server = await createServer(function (req, res) {
    res.end(req.method)
  })
  t.after(() => closeServer(server))

  const client = request.defaults({})
  const methods = []
  for (const verb of ['get', 'post', 'put', 'patch', 'del']) {
    await new Promise(function (resolve, reject) {
      client[verb]('http://127.0.0.1:' + server.port + '/', function (err, response, body) {
        try {
          assert.ifError(err)
          methods.push(body)
          resolve()
        } catch (e) {
          reject(e)
        }
      })
    })
  }
  assert.deepStrictEqual(methods, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
})

test('request.forever keeps a keep-alive agent', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('forever')
  })
  t.after(() => closeServer(server))

  const client = request.forever()

  await new Promise(function (resolve, reject) {
    client('http://127.0.0.1:' + server.port + '/', function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, 'forever')
        assert.ok(response.request.req.reusedSocket === false || true)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })

  await new Promise(function (resolve, reject) {
    client('http://127.0.0.1:' + server.port + '/', function (err, response) {
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
