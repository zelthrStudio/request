'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const stream = require('stream')
const request = require('../src')
const { createServer, closeServer, readBody } = require('./server')

test('streams response to a writable destination', async function (t) {
  const server = await createServer(function (req, res) {
    res.setHeader('content-type', 'text/plain')
    res.end('streamed content')
  })
  t.after(() => closeServer(server))

  const chunks = []
  const dest = new stream.Writable({
    write (chunk, enc, cb) {
      chunks.push(chunk)
      cb()
    }
  })

  await new Promise(function (resolve, reject) {
    request('http://127.0.0.1:' + server.port + '/').pipe(dest).on('finish', function () {
      resolve()
    })
    dest.on('error', reject)
  })

  assert.strictEqual(Buffer.concat(chunks).toString(), 'streamed content')
})

test('pipes a request body from a read stream', async function (t) {
  const server = await createServer(function (req, res) {
    readBody(req).then(function (body) {
      res.end(body)
    })
  })
  t.after(() => closeServer(server))

  const src = new stream.Readable({
    read () {}
  })

  await new Promise(function (resolve, reject) {
    src.pipe(request.post('http://127.0.0.1:' + server.port + '/', function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, 'piped body content')
        resolve()
      } catch (e) {
        reject(e)
      }
    }))
    src.push('piped body content')
    src.push(null)
  })
})

test('streams body from a stream option', async function (t) {
  const server = await createServer(function (req, res) {
    readBody(req).then(function (body) {
      res.end(body)
    })
  })
  t.after(() => closeServer(server))

  const src = new stream.Readable({
    read () {}
  })

  await new Promise(function (resolve, reject) {
    request.post({
      uri: 'http://127.0.0.1:' + server.port + '/',
      body: src
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, 'from stream option')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
    src.push('from stream option')
    src.push(null)
  })
})

test('data events fire in streaming mode', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('chunk one chunk two')
  })
  t.after(() => closeServer(server))

  let data = ''
  await new Promise(function (resolve, reject) {
    const req = request('http://127.0.0.1:' + server.port + '/')
    req.on('data', function (chunk) {
      data += chunk
    })
    req.on('complete', function () {
      resolve()
    })
    req.on('error', reject)
  })

  assert.strictEqual(data, 'chunk one chunk two')
})

test('pipes through a transform stream', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('lowercase')
  })
  t.after(() => closeServer(server))

  const upper = new stream.Transform({
    transform (chunk, enc, cb) {
      cb(null, chunk.toString().toUpperCase())
    }
  })

  let data = ''
  await new Promise(function (resolve, reject) {
    request('http://127.0.0.1:' + server.port + '/')
      .pipe(upper)
      .on('data', function (chunk) {
        data += chunk
      })
      .on('end', resolve)
      .on('error', reject)
  })

  assert.strictEqual(data, 'LOWERCASE')
})
