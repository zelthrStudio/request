'use strict'

// Tests for the web & Edge runtime entry (@zelthr/request/web): a
// fetch-based client sharing the circuit breaker, rate limiter and schema
// validator with the main package. Runs against local http servers; the
// code itself has no Node built-in imports, so it runs wherever fetch
// exists.

const { test } = require('node:test')
const assert = require('node:assert')
const request = require('../src/web')
const { createServer, closeServer, readBody } = require('./server')

test('web: basic GET with callback returns statusCode and body', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('hello web')
  })
  t.after(() => closeServer(server))

  const result = await new Promise(function (resolve, reject) {
    request.get('http://127.0.0.1:' + server.port + '/', function (err, response, body) {
      if (err) {
        reject(err)
      } else {
        resolve({ response, body })
      }
    })
  })
  assert.strictEqual(result.response.statusCode, 200)
  assert.strictEqual(result.body, 'hello web')
})

test('web: promise mode parses json and applies qs', async function (t) {
  const server = await createServer(function (req, res) {
    res.end(JSON.stringify({ url: req.url, method: req.method }))
  })
  t.after(() => closeServer(server))

  const response = await request.promise({
    uri: 'http://127.0.0.1:' + server.port + '/',
    qs: { page: 1, tags: ['a', 'b'] },
    json: true
  })
  assert.deepStrictEqual(response.body, { url: '/?page=1&tags=a&tags=b', method: 'GET' })
})

test('web: form bodies are urlencoded', async function (t) {
  const server = await createServer(async function (req, res) {
    const body = await readBody(req)
    res.end(body + '|' + req.headers['content-type'])
  })
  t.after(() => closeServer(server))

  const response = await request.promise({
    uri: 'http://127.0.0.1:' + server.port + '/',
    method: 'POST',
    form: { a: 1, b: 'two' }
  })
  assert.match(response.body, /^a=1&b=two\|application\/x-www-form-urlencoded$/)
})

test('web: basic and bearer auth headers are sent', async function (t) {
  const server = await createServer(function (req, res) {
    res.end(req.headers.authorization || 'none')
  })
  t.after(() => closeServer(server))

  const uri = 'http://127.0.0.1:' + server.port + '/'
  const basic = await request.promise({ uri, auth: { user: 'user', pass: 'päss' } })
  assert.strictEqual(basic.body, 'Basic ' + Buffer.from('user:päss', 'utf8').toString('base64'))
  const bearer = await request.promise({ uri, auth: { bearer: 'tok' } })
  assert.strictEqual(bearer.body, 'Bearer tok')
})

test('web: timeout rejects with ETIMEDOUT', async function (t) {
  const server = await createServer(function () {})
  t.after(() => closeServer(server))

  await assert.rejects(
    request.promise({ uri: 'http://127.0.0.1:' + server.port + '/', timeout: 50 }),
    function (err) {
      return err.code === 'ETIMEDOUT'
    }
  )
})

test('web: follows redirects and honors followRedirect false', async function (t) {
  const server = await createServer(function (req, res) {
    if (req.url === '/start') {
      res.writeHead(302, { location: '/target' })
      res.end()
      return
    }
    res.end('at target')
  })
  t.after(() => closeServer(server))

  const uri = 'http://127.0.0.1:' + server.port + '/start'
  const followed = await request.promise(uri)
  assert.strictEqual(followed.body, 'at target')

  const raw = await request.promise({ uri, followRedirect: false })
  assert.strictEqual(raw.statusCode, 302)
  assert.strictEqual(raw.body, '')
})

test('web: a POST becomes GET on 302 with followAllRedirects', async function (t) {
  const seen = []
  const server = await createServer(function (req, res) {
    seen.push(req.method)
    if (req.url === '/start') {
      res.writeHead(302, { location: '/target' })
      res.end()
      return
    }
    res.end('done')
  })
  t.after(() => closeServer(server))

  const response = await request.promise({
    uri: 'http://127.0.0.1:' + server.port + '/start',
    method: 'POST',
    body: 'x',
    followAllRedirects: true
  })
  assert.deepStrictEqual(seen, ['POST', 'GET'])
  assert.strictEqual(response.body, 'done')
})

test('web: cross-host redirect drops the authorization header', async function (t) {
  const received = []
  const target = await createServer(function (req, res) {
    received.push(req.headers.authorization)
    res.end('ok')
  })
  const source = await createServer(function (req, res) {
    res.writeHead(302, { location: 'http://127.0.0.1:' + target.port + '/x' })
    res.end()
  })
  t.after(() => closeServer(source))
  t.after(() => closeServer(target))

  await request.promise({
    uri: 'http://127.0.0.1:' + source.port + '/start',
    auth: { user: 'u', pass: 'p' }
  })
  assert.deepStrictEqual(received, [undefined])
})

test('web: maxRedirects is enforced', async function (t) {
  const server = await createServer(function (req, res) {
    res.writeHead(302, { location: '/loop' })
    res.end()
  })
  t.after(() => closeServer(server))

  await assert.rejects(
    request.promise({ uri: 'http://127.0.0.1:' + server.port + '/loop', maxRedirects: 3 }),
    /Exceeded maxRedirects/
  )
})

test('web: circuit breaker fails fast with CB_OPEN', async function (t) {
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    req.socket.destroy()
  })
  t.after(() => closeServer(server))

  const codes = []
  for (let i = 0; i < 3; i++) {
    await request.promise({
      uri: 'http://127.0.0.1:' + server.port + '/',
      circuitBreaker: { threshold: 2, cooldown: 60000 }
    }).catch(function (err) {
      codes.push(err.code)
    })
  }
  assert.deepStrictEqual(codes, ['ENETWORK', 'ENETWORK', 'CB_OPEN'])
  assert.strictEqual(hits, 2)
})

test('web: rateLimit spaces concurrent requests per host', async function (t) {
  const arrivals = []
  const server = await createServer(function (req, res) {
    arrivals.push(Date.now())
    res.end('ok')
  })
  t.after(() => closeServer(server))

  const uri = 'http://127.0.0.1:' + server.port + '/'
  await Promise.all([
    request.promise({ uri, rateLimit: { rate: 20, capacity: 1 } }),
    request.promise({ uri, rateLimit: { rate: 20, capacity: 1 } }),
    request.promise({ uri, rateLimit: { rate: 20, capacity: 1 } })
  ])
  assert.strictEqual(arrivals.length, 3)
  arrivals.sort(function (a, b) { return a - b })
  assert.ok(arrivals[1] - arrivals[0] >= 35, 'second request arrived too early')
  assert.ok(arrivals[2] - arrivals[1] >= 35, 'third request arrived too early')
})

test('web: dedupe coalesces concurrent identical GETs', async function (t) {
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    res.end('shared')
  })
  t.after(() => closeServer(server))

  const uri = 'http://127.0.0.1:' + server.port + '/'
  const [r1, r2] = await Promise.all([
    request.promise({ uri, dedupe: true }),
    request.promise({ uri, dedupe: true })
  ])
  assert.strictEqual(hits, 1)
  assert.strictEqual(r1.body, 'shared')
  assert.strictEqual(r2.body, 'shared')
  assert.strictEqual(r1.fromDedupe === true || r2.fromDedupe === true, true)
  assert.strictEqual(r1.fromDedupe === true && r2.fromDedupe === true, false)
})

test('web: dedupe without the option never coalesces', async function (t) {
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    res.end('ok')
  })
  t.after(() => closeServer(server))

  const uri = 'http://127.0.0.1:' + server.port + '/'
  await Promise.all([
    request.promise(uri),
    request.promise(uri),
    request.promise(uri)
  ])
  assert.strictEqual(hits, 3)
})

test('web: schema validation rejects invalid bodies', async function (t) {
  const server = await createServer(function (req, res) {
    res.end(JSON.stringify({ ok: false }))
  })
  t.after(() => closeServer(server))

  await assert.rejects(
    request.promise({
      uri: 'http://127.0.0.1:' + server.port + '/',
      json: true,
      schema: {
        safeParse (body) {
          return body.ok
            ? { success: true, output: body }
            : { success: false, issues: [{ path: ['ok'], message: 'must be true' }] }
        }
      }
    }),
    /must be true/
  )
})

test('web: encoding null returns a Uint8Array', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('bytes')
  })
  t.after(() => closeServer(server))

  const response = await request.promise({
    uri: 'http://127.0.0.1:' + server.port + '/',
    encoding: null
  })
  assert.ok(response.body instanceof Uint8Array)
  assert.strictEqual(Buffer.from(response.body).toString('utf8'), 'bytes')
})

test('web: maxBytes aborts an oversized body with EBODYLIMIT', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('x'.repeat(1024))
  })
  t.after(() => closeServer(server))

  await assert.rejects(
    request.promise({ uri: 'http://127.0.0.1:' + server.port + '/', maxBytes: 100 }),
    function (err) {
      return err.code === 'EBODYLIMIT'
    }
  )
})

test('web: network failures reject with ENETWORK', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('ok')
  })
  const port = server.port
  await closeServer(server)

  await assert.rejects(
    request.promise('http://127.0.0.1:' + port + '/'),
    function (err) {
      return err.code === 'ENETWORK'
    }
  )
})

test('web: abort rejects with Request aborted', async function (t) {
  const server = await createServer(function () {})
  t.after(() => closeServer(server))

  const req = request('http://127.0.0.1:' + server.port + '/')
  const pending = req.then(
    function () { throw new Error('expected rejection') },
    function (err) {
      return err.message
    }
  )
  req.abort()
  assert.strictEqual(await pending, 'Request aborted')
})

test('web: defaults merge options and verbs work', async function (t) {
  const server = await createServer(function (req, res) {
    res.end(JSON.stringify({ method: req.method, header: req.headers['x-default'] }))
  })
  t.after(() => closeServer(server))

  const client = request.defaults({
    uri: 'http://127.0.0.1:' + server.port + '/',
    headers: { 'X-Default': 'yes' },
    json: true
  })
  const response = await client.promise()
  assert.deepStrictEqual(response.body, { method: 'GET', header: 'yes' })
})

test('web: json bodies are sent and content-type set', async function (t) {
  const server = await createServer(async function (req, res) {
    const body = await readBody(req)
    res.end(body + '|' + req.headers['content-type'])
  })
  t.after(() => closeServer(server))

  const response = await request.promise({
    uri: 'http://127.0.0.1:' + server.port + '/',
    method: 'POST',
    json: { hello: 'world' }
  })
  assert.strictEqual(response.body, '{"hello":"world"}|application/json')
})
