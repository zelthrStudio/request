'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const stream = require('stream')
const request = require('../src')
const { createServer, closeServer, readBody } = require('./server')

test('retries 503 responses with Retry-After', async function (t) {
  let attempts = 0
  const server = await createServer(function (req, res) {
    attempts++
    if (attempts === 1) {
      res.statusCode = 503
      res.setHeader('retry-after', '0')
      res.end('busy')
    } else {
      res.end('recovered')
    }
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      retry: { limit: 2, backoff: 1, statusCodes: [503] }
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 200)
        assert.strictEqual(body, 'recovered')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
  assert.strictEqual(attempts, 2)
})

test('retries network errors for safe methods', async function (t) {
  let attempts = 0
  const server = await createServer(function (req, res) {
    attempts++
    if (attempts === 1) {
      req.socket.destroy()
    } else {
      res.end('recovered')
    }
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      retry: { limit: 2, backoff: 1 }
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, 'recovered')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
  assert.strictEqual(attempts, 2)
})

test('stops after the retry limit is reached', async function (t) {
  let attempts = 0
  const server = await createServer(function (req, res) {
    attempts++
    res.statusCode = 503
    res.end('still busy')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      retry: { limit: 2, backoff: 1 }
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 503)
        assert.strictEqual(body, 'still busy')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
  assert.strictEqual(attempts, 3)
})

test('retries POST when the body is replayable', async function (t) {
  let attempts = 0
  const server = await createServer(function (req, res) {
    attempts++
    readBody(req).then(function (body) {
      if (attempts === 1) {
        res.statusCode = 503
        res.end('busy')
      } else {
        res.end(body)
      }
    })
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request.post({
      uri: 'http://127.0.0.1:' + server.port + '/',
      body: 'payload',
      retry: { limit: 2, backoff: 1, methods: ['POST'] }
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 200)
        assert.strictEqual(body, 'payload')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
  assert.strictEqual(attempts, 2)
})

test('does not retry when the body is a stream', async function (t) {
  let attempts = 0
  const server = await createServer(function (req, res) {
    attempts++
    readBody(req).then(function () {
      res.statusCode = 503
      res.end('busy')
    })
  })
  t.after(() => closeServer(server))

  const src = new stream.Readable({
    read: function () {
      this.push('streamed payload')
      this.push(null)
    }
  })

  await new Promise(function (resolve, reject) {
    request.post({
      uri: 'http://127.0.0.1:' + server.port + '/',
      body: src,
      retry: { limit: 2, backoff: 1, methods: ['POST'] }
    }, function (err, response) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 503)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
  assert.strictEqual(attempts, 1)
})

test('respects a custom backoff function', async function (t) {
  let attempts = 0
  const delays = []
  const server = await createServer(function (req, res) {
    attempts++
    if (attempts === 1) {
      res.statusCode = 503
      res.end('busy')
    } else {
      res.end('done')
    }
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      retry: {
        limit: 2,
        backoff: function (attemptNumber) {
          delays.push(attemptNumber)
          return 1
        }
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
  assert.deepStrictEqual(delays, [1])
  assert.strictEqual(attempts, 2)
})

test('retry stays off by default', async function (t) {
  let attempts = 0
  const server = await createServer(function (req, res) {
    attempts++
    res.statusCode = 503
    res.end('busy')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request('http://127.0.0.1:' + server.port + '/', function (err, response) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 503)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
  assert.strictEqual(attempts, 1)
})
