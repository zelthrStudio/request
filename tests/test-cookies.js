'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const request = require('../src')
const { createServer, closeServer } = require('./server')

test('cookie jar round trips cookies', async function (t) {
  const server = await createServer(function (req, res) {
    if (req.url === '/set') {
      res.setHeader('set-cookie', ['session=abc123; Path=/', 'theme=dark; Path=/'])
      res.end('set')
    } else {
      res.end(req.headers.cookie || 'no cookies')
    }
  })
  t.after(() => closeServer(server))

  const jar = request.jar()

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/set',
      jar
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

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/check',
      jar
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.match(body, /session=abc123/)
        assert.match(body, /theme=dark/)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('cookies are not sent without a jar', async function (t) {
  const server = await createServer(function (req, res) {
    res.end(req.headers.cookie || 'no cookies')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request('http://127.0.0.1:' + server.port + '/', function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, 'no cookies')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('request.cookie parses a cookie string', function () {
  const cookie = request.cookie('name=value; Path=/; HttpOnly')
  assert.strictEqual(cookie.name, 'name')
  assert.strictEqual(cookie.value, 'value')
  assert.ok(cookie.httpOnly)
})

test('cookies follow redirects to the same host', async function (t) {
  let cookiesOnFinal = null
  const server = await createServer(function (req, res) {
    if (req.url === '/start') {
      res.setHeader('set-cookie', 'step=one; Path=/')
      res.statusCode = 302
      res.setHeader('location', '/end')
      res.end()
    } else {
      cookiesOnFinal = req.headers.cookie
      res.end('end')
    }
  })
  t.after(() => closeServer(server))

  const jar = request.jar()
  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/start',
      jar
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
  assert.match(cookiesOnFinal, /step=one/)
})
