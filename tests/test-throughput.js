'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const request = require('../src')
const { createServer, closeServer } = require('./server')

test('time: true reports downloadBytes and throughput', async function (t) {
  const payload = 'y'.repeat(262144)
  const server = await createServer(function (req, res) {
    res.setHeader('content-length', payload.length)
    res.end(payload)
  })
  t.after(() => closeServer(server))

  const response = await request.promise({
    uri: 'http://127.0.0.1:' + server.port + '/',
    time: true
  })

  assert.ok(response.timings)
  assert.strictEqual(response.timings.downloadBytes, payload.length)
  assert.ok(response.timings.throughput > 0)
  assert.ok(response.timings.download >= 0)
  assert.ok(response.timings.total > 0)
})

test('throughput is relative to the download phase', async function (t) {
  const payload = 'z'.repeat(65536)
  const server = await createServer(function (req, res) {
    res.setHeader('content-length', payload.length)
    res.end(payload)
  })
  t.after(() => closeServer(server))

  const response = await request.promise({
    uri: 'http://127.0.0.1:' + server.port + '/',
    time: true
  })

  const expected = response.timings.download > 0
    ? (payload.length / response.timings.download) * 1000
    : 0
  assert.ok(Math.abs(response.timings.throughput - expected) < 1)
})

test('progress events carry a relative throughput', async function (t) {
  const payload = 'w'.repeat(131072)
  const server = await createServer(function (req, res) {
    res.setHeader('content-length', payload.length)
    res.end(payload)
  })
  t.after(() => closeServer(server))

  const events = []
  await new Promise(function (resolve, reject) {
    const req = request({ uri: 'http://127.0.0.1:' + server.port + '/', progress: true }, function (err) {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
    req.on('progress', function (progress) {
      events.push(progress)
    })
  })

  assert.ok(events.length > 0)
  for (const event of events) {
    assert.ok(event.throughput >= 0)
  }
  const last = events[events.length - 1]
  assert.ok(last.throughput > 0)
})
