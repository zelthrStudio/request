'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const request = require('../src')
const { createServer, closeServer } = require('./server')

test('follows a simple redirect', async function (t) {
  const server = await createServer(function (req, res) {
    if (req.url === '/start') {
      res.statusCode = 302
      res.setHeader('location', '/end')
      res.end()
    } else {
      res.end('arrived at ' + req.url)
    }
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request('http://127.0.0.1:' + server.port + '/start', function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 200)
        assert.strictEqual(body, 'arrived at /end')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('does not follow POST redirects by default', async function (t) {
  const server = await createServer(function (req, res) {
    if (req.url === '/start') {
      res.statusCode = 301
      res.setHeader('location', '/end')
      res.end('redirecting')
    } else {
      res.end('end reached')
    }
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request.post('http://127.0.0.1:' + server.port + '/start', function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 301)
        assert.strictEqual(body, 'redirecting')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('followAllRedirects converts POST to GET', async function (t) {
  let methodOnEnd = null
  const server = await createServer(function (req, res) {
    if (req.url === '/start') {
      res.statusCode = 302
      res.setHeader('location', '/end')
      res.end()
    } else {
      methodOnEnd = req.method
      res.end('done')
    }
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request.post({
      uri: 'http://127.0.0.1:' + server.port + '/start',
      followAllRedirects: true
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 200)
        assert.strictEqual(body, 'done')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
  assert.strictEqual(methodOnEnd, 'GET')
})

test('resolves relative redirects', async function (t) {
  const server = await createServer(function (req, res) {
    if (req.url === '/a/b/c') {
      res.statusCode = 301
      res.setHeader('location', 'd')
      res.end()
    } else {
      res.end('landed on ' + req.url)
    }
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request('http://127.0.0.1:' + server.port + '/a/b/c', function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, 'landed on /a/b/d')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('errors when maxRedirects is exceeded', async function (t) {
  const server = await createServer(function (req, res) {
    res.statusCode = 302
    res.setHeader('location', req.url)
    res.end()
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/loop',
      maxRedirects: 3
    }, function (err) {
      try {
        assert.ok(err)
        assert.match(err.message, /Exceeded maxRedirects/)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('followRedirect false returns the redirect response', async function (t) {
  const server = await createServer(function (req, res) {
    res.statusCode = 302
    res.setHeader('location', '/somewhere')
    res.end('move along')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      followRedirect: false
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 302)
        assert.strictEqual(response.headers.location, '/somewhere')
        assert.strictEqual(body, 'move along')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('redirect event fires with the location', async function (t) {
  const server = await createServer(function (req, res) {
    if (req.url === '/one') {
      res.statusCode = 301
      res.setHeader('location', '/two')
      res.end()
    } else {
      res.end('second')
    }
  })
  t.after(() => closeServer(server))

  const locations = []
  await new Promise(function (resolve, reject) {
    const req = request('http://127.0.0.1:' + server.port + '/one', function () {})
    req.on('redirect', function () {
      locations.push(req.uri.pathname)
    })
    req.on('complete', function (response, body) {
      try {
        assert.strictEqual(body, 'second')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
  assert.deepStrictEqual(locations, ['/two'])
})

test('strips authorization when redirecting to another host', async function (t) {
  let authOnSecond = null
  const secondServer = await createServer(function (req, res) {
    authOnSecond = req.headers.authorization
    res.end('done')
  })
  t.after(() => closeServer(secondServer))

  const firstServer = await createServer(function (req, res) {
    res.statusCode = 302
    res.setHeader('location', 'http://localhost:' + secondServer.port + '/end')
    res.end()
  })
  t.after(() => closeServer(firstServer))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + firstServer.port + '/start',
      auth: { user: 'user', pass: 'pass' }
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
  assert.strictEqual(authOnSecond, undefined)
})
