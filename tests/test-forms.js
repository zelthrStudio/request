'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const request = require('../src')
const { createServer, closeServer, readBody } = require('./server')

test('form option sends urlencoded body', async function (t) {
  const server = await createServer(function (req, res) {
    readBody(req).then(function (body) {
      assert.strictEqual(req.headers['content-type'], 'application/x-www-form-urlencoded')
      res.end(body)
    })
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request.post({
      uri: 'http://127.0.0.1:' + server.port + '/',
      form: { name: 'zelthr', age: 30 }
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, 'name=zelthr&age=30')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('formData option sends multipart/form-data', async function (t) {
  const server = await createServer(function (req, res) {
    readBody(req).then(function (body) {
      assert.match(req.headers['content-type'], /^multipart\/form-data; boundary=/)
      res.end(JSON.stringify({ type: req.headers['content-type'], body }))
    })
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request.post({
      uri: 'http://127.0.0.1:' + server.port + '/',
      formData: {
        field: 'value1',
        another: 'value2'
      }
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        const data = JSON.parse(body)
        assert.match(data.body, /name="field"/)
        assert.match(data.body, /value1/)
        assert.match(data.body, /name="another"/)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('multipart option sends multipart/related body', async function (t) {
  const server = await createServer(function (req, res) {
    readBody(req).then(function (body) {
      assert.match(req.headers['content-type'], /^multipart\/related; boundary=/)
      res.end(body)
    })
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request.post({
      uri: 'http://127.0.0.1:' + server.port + '/',
      multipart: [
        { 'content-type': 'text/plain', body: 'first part' },
        { 'content-type': 'text/plain', body: 'second part' }
      ]
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.match(body, /first part/)
        assert.match(body, /second part/)
        assert.match(body, /--[a-f0-9]+--/)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('json true with body serializes the body', async function (t) {
  const server = await createServer(function (req, res) {
    readBody(req).then(function (body) {
      res.end(JSON.stringify({ received: body }))
    })
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request.post({
      uri: 'http://127.0.0.1:' + server.port + '/',
      json: true,
      body: { nested: { deep: true } }
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body.received, '{"nested":{"deep":true}}')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('body string is sent with content-length', async function (t) {
  const server = await createServer(function (req, res) {
    readBody(req).then(function (body) {
      assert.strictEqual(req.headers['content-length'], String(Buffer.byteLength('raw body')))
      res.end(body)
    })
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request.post({
      uri: 'http://127.0.0.1:' + server.port + '/',
      body: 'raw body'
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, 'raw body')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})
