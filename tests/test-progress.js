'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const request = require('../src')
const { createServer, closeServer } = require('./server')

test('progress: true reports download progress', async function (t) {
  const payload = 'x'.repeat(65536)
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
  const last = events[events.length - 1]
  assert.strictEqual(last.phase, 'download')
  assert.strictEqual(last.downloaded, payload.length)
  assert.strictEqual(last.downloadedTotal, payload.length)
  assert.strictEqual(last.percent, 100)
  assert.ok(last.throughput >= 0)
})

test('progress: true reports upload progress for replayable bodies', async function (t) {
  const server = await createServer(function (req, res) {
    req.resume()
    req.on('end', function () {
      res.end('ok')
    })
  })
  t.after(() => closeServer(server))

  const uploadEvents = []
  const response = await new Promise(function (resolve, reject) {
    const req = request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      method: 'POST',
      body: 'hello upload',
      progress: true
    }, function (err, response) {
      if (err) {
        reject(err)
      } else {
        resolve(response)
      }
    })
    req.on('progress', function (progress) {
      if (progress.phase === 'upload') {
        uploadEvents.push(progress)
      }
    })
  })

  assert.strictEqual(response.statusCode, 200)
  assert.ok(uploadEvents.length > 0)
  const last = uploadEvents[uploadEvents.length - 1]
  assert.strictEqual(last.uploaded, Buffer.byteLength('hello upload'))
  assert.strictEqual(last.uploadedTotal, Buffer.byteLength('hello upload'))
  assert.strictEqual(last.uploadPercent, 100)
})

test('progress: true tracks streamed uploads', async function (t) {
  const server = await createServer(function (req, res) {
    req.resume()
    req.on('end', function () {
      res.end('ok')
    })
  })
  t.after(() => closeServer(server))

  const uploadEvents = []
  await new Promise(function (resolve, reject) {
    const req = request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      method: 'POST',
      progress: true
    }, function (err) {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
    req.on('progress', function (progress) {
      if (progress.phase === 'upload') {
        uploadEvents.push(progress)
      }
    })
    req.end('streamed upload body')
  })

  assert.ok(uploadEvents.length > 0)
  const last = uploadEvents[uploadEvents.length - 1]
  assert.strictEqual(last.uploaded, Buffer.byteLength('streamed upload body'))
})

test('without progress option no events are emitted', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('no events')
  })
  t.after(() => closeServer(server))

  let emitted = false
  await new Promise(function (resolve, reject) {
    const req = request({ uri: 'http://127.0.0.1:' + server.port + '/' }, function (err) {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
    req.on('progress', function () {
      emitted = true
    })
  })
  assert.strictEqual(emitted, false)
})
