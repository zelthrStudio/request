'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const request = require('../src')
const { createServer, closeServer } = require('./server')

test('request.mock.add intercepts matching requests', async function (t) {
  request.mock.add('/mocked', function () {
    return {
      statusCode: 201,
      headers: { 'x-mock': '1' },
      body: 'mocked body'
    }
  })
  t.after(() => request.mock.clear())

  // Port 1 is unreachable: a hit on the mock proves no network access.
  const response = await request.promise('http://127.0.0.1:1/mocked')
  assert.strictEqual(response.statusCode, 201)
  assert.strictEqual(response.headers['x-mock'], '1')
  assert.strictEqual(response.body, 'mocked body')
  assert.strictEqual(response.isMock, true)
})

test('mock handlers may be async', async function (t) {
  request.mock.add(/\/async-mock$/, async function () {
    await new Promise(function (resolve) {
      setTimeout(resolve, 5)
    })
    return { statusCode: 202, body: 'async mock' }
  })
  t.after(() => request.mock.clear())

  const response = await request.promise('http://127.0.0.1:1/async-mock')
  assert.strictEqual(response.statusCode, 202)
  assert.strictEqual(response.body, 'async mock')
})

test('request.mock.clear removes all mocks', async function (t) {
  request.mock.add('/gone', function () {
    return { statusCode: 200, body: 'stale' }
  })
  request.mock.clear()

  const server = await createServer(function (req, res) {
    res.end('real server')
  })
  t.after(() => closeServer(server))

  const response = await request.promise('http://127.0.0.1:' + server.port + '/gone')
  assert.strictEqual(response.body, 'real server')
  assert.strictEqual(response.isMock, undefined)
})

test('per-request mock option with a static spec', async function (t) {
  const response = await request.promise({
    uri: 'http://127.0.0.1:1/static',
    mock: { statusCode: 418, headers: { 'x-teapot': 'yes' }, body: "I'm a teapot" }
  })
  assert.strictEqual(response.statusCode, 418)
  assert.strictEqual(response.headers['x-teapot'], 'yes')
  assert.strictEqual(response.body, "I'm a teapot")
})

test('per-request mock function returning null passes through to the network', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('network response')
  })
  t.after(() => closeServer(server))

  const response = await request.promise({
    uri: 'http://127.0.0.1:' + server.port + '/',
    mock: function () {
      return null
    }
  })
  assert.strictEqual(response.body, 'network response')
  assert.strictEqual(response.isMock, undefined)
})

test('request.mock.disable bypasses mocks', async function (t) {
  request.mock.add('/disabled', function () {
    return { statusCode: 200, body: 'mocked' }
  })
  request.mock.disable()
  t.after(() => {
    request.mock.enable()
    request.mock.clear()
  })

  const server = await createServer(function (req, res) {
    res.end('real again')
  })
  t.after(() => closeServer(server))

  const response = await request.promise('http://127.0.0.1:' + server.port + '/disabled')
  assert.strictEqual(response.body, 'real again')
})
