'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const request = require('../src')
const { createServer, closeServer } = require('./server')

test('time option records timing phases', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('timed')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/',
      time: true
    }, function (err, response) {
      try {
        assert.ifError(err)
        assert.ok(response.timings, 'has timings')
        assert.ok(typeof response.timings.total === 'number')
        assert.ok(response.timingPhases, 'has timingPhases')
        assert.ok(typeof response.elapsedTime === 'number')
        assert.ok(response.timingStart)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})
