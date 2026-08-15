'use strict'

// Regression tests for the fourth audit pass (report-3.md): RFC 7234 304
// revalidation must not duplicate cache entries, dedupe keys must split on
// credentials, non-positive rate limits must be rejected instead of
// hanging, agent pool keys must not collapse function options, the cookie
// jar must stay bounded, the web client must reject options it cannot
// honor, invalid JSON must fail loudly, pagination must survive non-string
// body.next values, BOM stripping must cover the utf-8 alias, gzip must
// control accept-encoding, and mock bodies must be validated.

const { test } = require('node:test')
const assert = require('node:assert')
const request = require('../src')
const web = require('../src/web')
const { getAgent } = require('../src/transport/pool')
const { createServer, closeServer } = require('./server')

test('cache: a 304 revalidation does not duplicate the stored entry', async function (t) {
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    if (req.headers['if-none-match'] === '"v1"') {
      res.statusCode = 304
      res.end()
      return
    }
    res.setHeader('etag', '"v1"')
    res.setHeader('cache-control', 'max-age=0')
    res.end('revalidated body')
  })
  t.after(() => closeServer(server))
  t.after(() => request.cache.clear())

  const url = 'http://127.0.0.1:' + server.port + '/'
  const first = await request.promise({ uri: url, cache: true })
  assert.strictEqual(first.body, 'revalidated body')
  assert.strictEqual(request.cache.size, 1)

  const second = await request.promise({ uri: url, cache: true })
  assert.strictEqual(second.body, 'revalidated body')
  assert.strictEqual(second.revalidated, true)
  assert.strictEqual(hits, 2)
  // Before the fix the served 304 body was stored again on every
  // revalidation, duplicating the entry for the URL.
  assert.strictEqual(request.cache.size, 1)
})

test('dedupe: concurrent requests with different credentials are not coalesced', async function (t) {
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    setTimeout(function () { res.end('ok') }, 30)
  })
  t.after(() => closeServer(server))

  const url = 'http://127.0.0.1:' + server.port + '/'
  const [a, b] = await Promise.all([
    request.promise({ uri: url, dedupe: true, headers: { authorization: 'Bearer tokenA' } }),
    request.promise({ uri: url, dedupe: true, headers: { authorization: 'Bearer tokenB' } })
  ])
  assert.strictEqual(a.body, 'ok')
  assert.strictEqual(b.body, 'ok')
  assert.strictEqual(hits, 2)

  const [c, d] = await Promise.all([
    request.promise({ uri: url, dedupe: true, headers: { cookie: 'session=one' } }),
    request.promise({ uri: url, dedupe: true, headers: { cookie: 'session=two' } })
  ])
  assert.strictEqual(c.body, 'ok')
  assert.strictEqual(d.body, 'ok')
  assert.strictEqual(hits, 4)

  // Identical credentials coalesce onto one request.
  const before = hits
  await Promise.all([
    request.promise({ uri: url, dedupe: true, headers: { authorization: 'Bearer tokenA' } }),
    request.promise({ uri: url, dedupe: true, headers: { authorization: 'Bearer tokenA' } })
  ])
  assert.strictEqual(hits, before + 1)
})

test('web: dedupe splits requests with different credentials', async function (t) {
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    setTimeout(function () { res.end('ok') }, 30)
  })
  t.after(() => closeServer(server))

  const url = 'http://127.0.0.1:' + server.port + '/'
  await Promise.all([
    web.promise({ uri: url, dedupe: true, headers: { authorization: 'Bearer A' } }),
    web.promise({ uri: url, dedupe: true, headers: { authorization: 'Bearer B' } })
  ])
  assert.strictEqual(hits, 2)

  const before = hits
  await Promise.all([
    web.promise({ uri: url, dedupe: true, headers: { authorization: 'Bearer A' } }),
    web.promise({ uri: url, dedupe: true, headers: { authorization: 'Bearer A' } })
  ])
  assert.strictEqual(hits, before + 1)
})

test('rateLimit: non-positive rate/capacity are rejected loudly, not hung', async function (t) {
  const url = 'http://127.0.0.1:1/'
  await assert.rejects(request.promise({ uri: url, rateLimit: { rate: 0 } }), /positive finite number/)
  await assert.rejects(request.promise({ uri: url, rateLimit: { rate: -1 } }), /positive finite number/)
  await assert.rejects(request.promise({ uri: url, rateLimit: { rate: NaN, capacity: 5 } }), /positive finite number/)
  await assert.rejects(request.promise({ uri: url, rateLimit: { rate: 1, capacity: 0 } }), /at least 1/)
  await assert.rejects(request.promise({ uri: url, rateLimit: { rate: 1, capacity: NaN } }), /at least 1/)
  await assert.rejects(web.promise({ uri: url, rateLimit: { rate: 0 } }), /positive finite number/)

  // A falsy number still disables the limiter (matching `rateLimit: false`).
  const zeroErr = await request.promise({ uri: url, rateLimit: 0 }).catch(function (err) { return err })
  assert.ok(zeroErr instanceof Error)
  assert.ok(!/rateLimit/.test(String(zeroErr.message)), 'rateLimit: 0 must disable, not validate')
})

test('pool: distinct agentOptions functions never share an agent', function (t) {
  const uri = new URL('http://127.0.0.1/')
  const fnA = function a () {}
  const fnB = function b () {}
  const agentA = getAgent({ uri, agentOptions: { maxSockets: 4, createConnection: fnA } })
  const agentB = getAgent({ uri, agentOptions: { maxSockets: 4, createConnection: fnB } })
  // JSON.stringify drops functions, so both options objects collapsed onto
  // one pool key before the fix.
  assert.notStrictEqual(agentA, agentB)
  // Identical options in any key order reuse the same agent.
  const agentA2 = getAgent({ uri, agentOptions: { createConnection: fnA, maxSockets: 4 } })
  assert.strictEqual(agentA, agentA2)
})

test('cookies: the jar is bounded (oldest cookie dropped past the cap)', function (t) {
  const jar = request.jar()
  for (let i = 0; i < 1005; i++) {
    jar.setCookie('k' + i + '=v; Path=/', 'http://cap.test/')
  }
  assert.ok(jar._jar._cookies.length <= 1000)
  const names = jar._jar._cookies.map(function (cookie) { return cookie.key })
  assert.ok(names.indexOf('k1004') !== -1, 'newest cookie must survive')
  assert.ok(names.indexOf('k0') === -1, 'oldest cookie must be dropped')
})

test('cookies: an unparseable Max-Age is dropped, not stored forever', function (t) {
  const jar = request.jar()
  jar.setCookie('a=1; Max-Age=abc; Path=/', 'http://x.test/')
  assert.strictEqual(jar.getCookieString('http://x.test/'), '')
  jar.setCookie('b=2; Max-Age=60; Path=/', 'http://x.test/')
  assert.strictEqual(jar.getCookieString('http://x.test/'), 'b=2')
  jar.setCookie('c=3; Path=/', 'http://x.test/')
  assert.strictEqual(jar.getCookieString('http://x.test/'), 'b=2; c=3')
})

test('web: encoding "latin1" decodes single-byte bodies without throwing', async function (t) {
  const server = await createServer(function (req, res) {
    res.end(Buffer.from([0xE9, 0x74, 0xE9]))
  })
  t.after(() => closeServer(server))

  const response = await web.promise({ uri: 'http://127.0.0.1:' + server.port + '/', encoding: 'latin1' })
  assert.strictEqual(response.body, 'été')
})

test('web: options the fetch build cannot honor are rejected, not ignored', async function (t) {
  const uri = 'http://127.0.0.1:1/'
  for (const name of ['brotli', 'removeRefererHeader', 'jsonReplacer', 'useQuerystring', 'qsParseOptions']) {
    const options = { uri }
    options[name] = true
    await assert.rejects(web.promise(options), function (err) {
      return err.code === 'EUNSUPPORTED'
    }, name + ' must be rejected with EUNSUPPORTED')
  }
})

test('json: an invalid JSON body fails the request loudly (EJSONPARSE)', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('this is not json')
  })
  t.after(() => closeServer(server))
  const url = 'http://127.0.0.1:' + server.port + '/'

  await assert.rejects(request.promise({ uri: url, json: true }), function (err) {
    return err.code === 'EJSONPARSE'
  })
  await assert.rejects(web.promise({ uri: url, json: true }), function (err) {
    return err.code === 'EJSONPARSE'
  })
})

test('paginate: a non-string body.next ends (or coerces) instead of throwing', async function (t) {
  const server = await createServer(function (req, res) {
    const page = {
      '/?p=1': { items: [1, 2], next: 123 },
      '/123': { items: [3], next: {} }
    }[req.url]
    res.end(JSON.stringify(page || { items: [] }))
  })
  t.after(() => closeServer(server))
  const url = 'http://127.0.0.1:' + server.port + '/?p=1'

  const collected = []
  for await (const item of request.paginate(url, {
    json: true,
    paginate: { transform: function (response) { return response.body.items } }
  })) {
    collected.push(item)
  }
  // next: 123 is coerced to a URL; next: {} must end the pagination (before
  // the fix new URL(String({})) threw a TypeError inside the generator).
  assert.deepStrictEqual(collected, [1, 2, 3])
})

test('encoding "utf-8" strips the BOM like "utf8" (JSON still parses)', async function (t) {
  const server = await createServer(function (req, res) {
    const prefix = Buffer.from([0xEF, 0xBB, 0xBF])
    res.end(Buffer.concat([prefix, Buffer.from('{"a":1}')]))
  })
  t.after(() => closeServer(server))
  const url = 'http://127.0.0.1:' + server.port + '/'

  const main = await request.promise({ uri: url, json: true, encoding: 'utf-8' })
  assert.deepStrictEqual(main.body, { a: 1 })

  const w = await web.promise({ uri: url, json: true, encoding: 'utf-8' })
  assert.deepStrictEqual(w.body, { a: 1 })
})

test('gzip: a manual accept-encoding is overridden so br cannot slip through undecoded', async function (t) {
  let acceptEncoding = null
  const server = await createServer(function (req, res) {
    acceptEncoding = req.headers['accept-encoding']
    res.end('ok')
  })
  t.after(() => closeServer(server))
  const url = 'http://127.0.0.1:' + server.port + '/'

  await request.promise({ uri: url, gzip: true, headers: { 'accept-encoding': 'gzip, deflate, br' } })
  assert.strictEqual(acceptEncoding, 'gzip, deflate')

  await request.promise({ uri: url, gzip: true, brotli: true, headers: { 'accept-encoding': 'gzip, deflate, br' } })
  assert.strictEqual(acceptEncoding, 'gzip, deflate, br')
})

test('mock: an object body fails loudly instead of serving an empty body', async function (t) {
  await assert.rejects(request.promise({
    uri: 'http://127.0.0.1:1/',
    mock: { statusCode: 200, body: { foo: 1 } }
  }), /mock response body must be a string, Buffer, or stream/)
})

test('dedupe: the in-flight map is bounded; eviction never breaks coalescing', async function (t) {
  const { inFlight } = require('../src/core/dedup')
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    setTimeout(function () { res.end('ok') }, 100)
  })
  t.after(() => closeServer(server))
  // Clean up the fake entries (they never complete on their own).
  t.after(() => {
    for (const key of Array.from(inFlight.keys())) {
      if (key.indexOf('fake/') === 0) {
        inFlight.delete(key)
      }
    }
  })
  const url = 'http://127.0.0.1:' + server.port + '/'

  // Fill the map to its cap so the next insert must evict the oldest entry.
  for (let i = 0; i < 1000; i++) {
    inFlight.set('fake/' + i, { primary: {}, waiters: [] })
  }
  const [a, b] = await Promise.all([
    request.promise({ uri: url, dedupe: true }),
    request.promise({ uri: url, dedupe: true })
  ])
  assert.strictEqual(a.body, 'ok')
  assert.strictEqual(b.body, 'ok')
  // The insert over the cap evicted the oldest fake entry...
  assert.ok(!inFlight.has('fake/0'))
  // ...and the map never exceeds its bound.
  assert.ok(inFlight.size <= 1000)
  // Coalescing still works for requests that did not get evicted.
  assert.strictEqual(hits, 1)
})
