'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const request = require('../src')
const { createServer, closeServer } = require('./server')

test('beforeRequest hook can mutate the request', async function (t) {
  let hooked = null
  const server = await createServer(function (req, res) {
    hooked = req.headers['x-hooked']
    res.end('ok')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      hooks: {
        beforeRequest: [
          function (req) {
            req.setHeader('x-hooked', 'yes')
          }
        ]
      }
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
  assert.strictEqual(hooked, 'yes')
})

test('async beforeRequest hooks run in order', async function (t) {
  const order = []
  const server = await createServer(function (req, res) {
    res.end(req.headers['x-order'] || '')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      hooks: {
        beforeRequest: [
          async function (req) {
            order.push('a')
            await new Promise(function (resolve) { setTimeout(resolve, 5) })
            req.setHeader('x-order', 'a')
          },
          function (req) {
            order.push('b')
            req.setHeader('x-order', req.getHeader('x-order') + 'b')
          }
        ]
      }
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, 'ab')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
  assert.deepStrictEqual(order, ['a', 'b'])
})

test('throwing beforeRequest hook rejects the request', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('never')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      hooks: {
        beforeRequest: [
          function () {
            throw new Error('hook boom')
          }
        ]
      }
    }, function (err) {
      try {
        assert.ok(err)
        assert.strictEqual(err.message, 'hook boom')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('afterResponse hook can replace the response', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('original body')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      hooks: {
        afterResponse: [
          function () {
            return { statusCode: 299, body: 'replaced by hook' }
          }
        ]
      }
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 299)
        assert.strictEqual(body, 'replaced by hook')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('afterResponse hooks run in order over the replacement', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('x')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      hooks: {
        afterResponse: [
          function () {
            return { statusCode: 201, body: 'first' }
          },
          function (response) {
            return { statusCode: 202, body: response.body + '-second' }
          }
        ]
      }
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 202)
        assert.strictEqual(body, 'first-second')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('throwing afterResponse hook rejects the request', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('x')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      hooks: {
        afterResponse: [
          function () {
            throw new Error('after boom')
          }
        ]
      }
    }, function (err) {
      try {
        assert.ok(err)
        assert.strictEqual(err.message, 'after boom')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('afterResponse hooks are skipped on redirects', async function (t) {
  let hookRuns = 0
  const server = await createServer(function (req, res) {
    if (req.url === '/start') {
      res.statusCode = 302
      res.setHeader('location', '/end')
      res.end()
    } else {
      res.end('final')
    }
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/start',
      hooks: {
        afterResponse: [
          function () {
            hookRuns++
            return undefined
          }
        ]
      }
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 200)
        assert.strictEqual(body, 'final')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
  assert.strictEqual(hookRuns, 1)
})
