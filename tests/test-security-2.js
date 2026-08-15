'use strict'

// Regression tests for the second audit pass (report-1.md). Only
// request-package findings are in scope.

const { test } = require('node:test')
const assert = require('node:assert')
const net = require('node:net')
const { Readable } = require('stream')
const request = require('../src')
const { HttpCache } = require('../src/cache')
const { qs } = require('../src/body')
const { createServer, closeServer, readBody } = require('./server')

test('H-1: a malformed Location header errors the request instead of crashing', async function (t) {
  const server = await createServer(function (req, res) {
    res.writeHead(302, { location: 'http://[' })
    res.end()
  })
  t.after(() => closeServer(server))

  const err = await new Promise(function (resolve, reject) {
    request.get({
      uri: 'http://127.0.0.1:' + server.port + '/',
      followAllRedirects: true
    }, function (err) {
      if (err) {
        resolve(err)
      } else {
        reject(new Error('expected an error'))
      }
    })
  })
  assert.match(err.message, /Invalid redirect location/)
})

test('A4: promise mode rejects on a malformed Location', async function (t) {
  const server = await createServer(function (req, res) {
    res.writeHead(302, { location: 'http://exa mple.com' })
    res.end()
  })
  t.after(() => closeServer(server))

  await assert.rejects(
    request.promise({ uri: 'http://127.0.0.1:' + server.port + '/', followAllRedirects: true }),
    /Invalid redirect location/
  )
})

test('A11: an angle-bracketed Location is not followed', async function (t) {
  let seenUrl
  const server = await createServer(function (req, res) {
    seenUrl = req.url
    res.writeHead(302, { location: '<http://x>' })
    res.end('stuck')
  })
  t.after(() => closeServer(server))

  const result = await new Promise(function (resolve, reject) {
    request.get('http://127.0.0.1:' + server.port + '/start', function (err, response, body) {
      if (err) {
        reject(err)
      } else {
        resolve({ response, body })
      }
    })
  })
  assert.strictEqual(result.body, 'stuck')
  assert.strictEqual(result.response.statusCode, 302)
  assert.strictEqual(seenUrl, '/start')
})

test('M-1: requests with and without a custom lookup use separate agents', function () {
  const lookup = function (hostname, options, cb) {
    cb(null, '127.0.0.1', 4)
  }
  const base = {
    uri: { protocol: 'http:', href: 'http://localhost:1/' },
    agent: undefined,
    proxy: null,
    pool: undefined,
    agentOptions: undefined,
    forever: undefined
  }
  const pool = require('../src/transport').getAgent
  const without = pool(base)
  const withLookup = pool(Object.assign({}, base, { lookup }))
  assert.notStrictEqual(withLookup, without, 'a lookup request must not share the default agent')
})

test('M-1: a custom lookup is consulted end-to-end, not bypassed by socket reuse', async function (t) {
  let lookupCalls = 0
  const lookup = function (hostname, options, cb) {
    lookupCalls++
    // Node may query with all: true (autoSelectFamily path).
    if (options && options.all) {
      cb(null, [{ address: '127.0.0.1', family: 4 }])
    } else {
      cb(null, '127.0.0.1', 4)
    }
  }
  const server = await createServer(function (req, res) {
    res.end('ok')
  })
  t.after(() => closeServer(server))

  const uri = 'http://localhost:' + server.port + '/'
  // First request without lookup: seeds a keep-alive socket in the shared
  // pool that a buggy pool would hand to the second request.
  const one = await request.promise(uri)
  assert.strictEqual(one.body, 'ok')
  const two = await request.promise({ uri, lookup })
  assert.strictEqual(two.body, 'ok')
  assert.strictEqual(lookupCalls, 1, 'the lookup must be consulted, not bypassed by socket reuse')
})

test('M-2: a silent proxy CONNECT times out instead of hanging forever', async function (t) {
  // A bare TCP proxy that accepts the connection but never answers CONNECT
  // (an http.Server would auto-close the connection for unhandled CONNECTs,
  // which is not the hang scenario).
  const sockets = new Set()
  const proxy = net.createServer(function (socket) {
    sockets.add(socket)
    socket.on('close', function () {
      sockets.delete(socket)
    })
  })
  await new Promise(function (resolve) {
    proxy.listen(0, '127.0.0.1', resolve)
  })
  t.after(function () {
    for (const socket of sockets) {
      socket.destroy()
    }
    return new Promise(function (resolve) {
      proxy.close(resolve)
    })
  })

  await assert.rejects(
    request.promise({
      uri: 'https://example.com/',
      proxy: 'http://127.0.0.1:' + proxy.address().port,
      timeout: 300
    }),
    function (err) {
      return err.code === 'ETIMEDOUT'
    }
  )
})

test('M-3: responses to requests with a Cookie header are not cached', async function (t) {
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    res.setHeader('cache-control', 'max-age=3600')
    res.end('session data')
  })
  t.after(() => closeServer(server))
  const cache = new HttpCache({ ttl: 60000 })

  await request.promise({ uri: 'http://127.0.0.1:' + server.port + '/', cache, headers: { cookie: 'sid=1' } })
  await request.promise({ uri: 'http://127.0.0.1:' + server.port + '/', cache })
  assert.strictEqual(hits, 2, 'the cookie-scoped response must not be cached')
})

test('M-3: Cache-Control: private responses are not cached', async function (t) {
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    res.setHeader('cache-control', 'private, max-age=3600')
    res.end('private data')
  })
  t.after(() => closeServer(server))
  const cache = new HttpCache({ ttl: 60000 })

  await request.promise({ uri: 'http://127.0.0.1:' + server.port + '/', cache })
  await request.promise({ uri: 'http://127.0.0.1:' + server.port + '/', cache })
  assert.strictEqual(hits, 2)
})

test('M-3: the cache respects a total byte budget', function () {
  const cache = new HttpCache({ maxEntries: 100, maxBytes: 10 })
  const self = function (url) {
    return {
      method: 'GET',
      uri: { href: url },
      getHeader: function () { return undefined },
      hasHeader: function () { return false }
    }
  }
  cache.store(self('http://x/a'), { statusCode: 200, headers: {} }, Buffer.alloc(20))
  assert.strictEqual(cache.size, 0, 'a body over the byte budget must be evicted immediately')
  cache.store(self('http://x/a'), { statusCode: 200, headers: {} }, Buffer.alloc(4))
  cache.store(self('http://x/b'), { statusCode: 200, headers: {} }, Buffer.alloc(4))
  cache.store(self('http://x/c'), { statusCode: 200, headers: {} }, Buffer.alloc(4))
  // 12 bytes total against a 10-byte budget: the oldest URL must go.
  assert.strictEqual(cache.size, 2)
  assert.ok(!cache.lookup(self('http://x/a')))
  assert.ok(cache.lookup(self('http://x/b')))
  assert.ok(cache.lookup(self('http://x/c')))
})

test('L-1: the proxy absolute-form request line has no URL userinfo', async function (t) {
  let proxyUrl
  const proxy = await createServer(function (req, res) {
    proxyUrl = req.url
    res.end('via proxy')
  })
  t.after(() => closeServer(proxy))

  const response = await request.promise({
    uri: 'http://user:secret@example.com/path?q=1#frag',
    proxy: 'http://127.0.0.1:' + proxy.port
  })
  assert.strictEqual(response.body, 'via proxy')
  assert.strictEqual(proxyUrl, 'http://example.com/path?q=1')
})

test('L-2: qs() appends the query before the fragment, not inside it', async function (t) {
  let seenUrl
  const server = await createServer(function (req, res) {
    seenUrl = req.url
    res.end('ok')
  })
  t.after(() => closeServer(server))

  await request.promise({ uri: 'http://127.0.0.1:' + server.port + '/path#frag', qs: { a: 1 } })
  assert.strictEqual(seenUrl, '/path?a=1')
})

test('L-8: the Referer on a same-host redirect has no userinfo', async function (t) {
  let referer
  const target = await createServer(function (req, res) {
    referer = req.headers.referer
    res.end('done')
  })
  t.after(() => closeServer(target))

  const source = await createServer(function (req, res) {
    res.writeHead(302, { location: 'http://127.0.0.1:' + target.port + '/' })
    res.end()
  })
  t.after(() => closeServer(source))

  await request.promise({
    uri: 'http://user:secret@127.0.0.1:' + source.port + '/start',
    followAllRedirects: true
  })
  assert.strictEqual(referer, 'http://127.0.0.1:' + source.port + '/start')
})

test('L-10: co.ke / co.ug are rejected as cookie Domain attributes', function () {
  const jar = request.jar()
  jar.setCookie('a=1; Domain=co.ke; Path=/', 'http://evil.co.ke/')
  jar.setCookie('b=1; Domain=co.ug; Path=/', 'http://evil.co.ug/')
  jar.setCookie('c=1; Domain=example.co.ke; Path=/', 'http://www.example.co.ke/')
  assert.strictEqual(jar.getCookieString('http://evil.co.ke/'), '')
  assert.strictEqual(jar.getCookieString('http://evil.co.ug/'), '')
  assert.strictEqual(jar.getCookieString('http://www.example.co.ke/'), 'c=1')
})

test('A1: a non-ASCII array body keeps its exact byte length', async function (t) {
  let contentLength
  const server = await createServer(async function (req, res) {
    contentLength = req.headers['content-length']
    const body = await readBody(req)
    res.end(body)
  })
  t.after(() => closeServer(server))

  const expected = 'สวัสดี'
  const response = await request.promise({
    uri: 'http://127.0.0.1:' + server.port + '/',
    method: 'POST',
    body: [expected]
  })
  assert.strictEqual(response.body, expected)
  assert.strictEqual(Number(contentLength), Buffer.byteLength(expected, 'utf8'))
})

test('A1: multipart bodies with non-ASCII parts are not truncated', async function (t) {
  let contentLength
  const server = await createServer(async function (req, res) {
    contentLength = req.headers['content-length']
    const body = await readBody(req)
    res.end(body)
  })
  t.after(() => closeServer(server))

  const thai = 'สวัสดี'
  const response = await request.promise({
    uri: 'http://127.0.0.1:' + server.port + '/',
    method: 'POST',
    multipart: [{ 'content-type': 'text/plain', body: thai }]
  })
  assert.ok(response.body.indexOf(thai) !== -1, 'the Thai part must arrive intact')
  assert.strictEqual(Number(contentLength), Buffer.byteLength(response.body, 'utf8'))
})

test('A5: request.promise rejects (does not throw synchronously) on an invalid URI', async function () {
  let promise
  assert.doesNotThrow(function () {
    promise = request.promise('not a url')
  })
  await assert.rejects(promise, /Invalid URI/)
})

test('A8: defaults().cookie parses cookie strings', function () {
  const defaults = request.defaults({})
  const cookie = defaults.cookie('a=b; Path=/')
  assert.strictEqual(cookie.key, 'a')
  assert.strictEqual(cookie.value, 'b')
})

test('A9: qs.stringify reports a clear error on circular objects', function () {
  const obj = { a: { b: {} } }
  obj.a.b.self = obj
  assert.throws(function () {
    qs.stringify(obj)
  }, /circular/)
})

test('A10: expired cookies are pruned from the jar', async function () {
  const jar = request.jar()
  jar.setCookie('a=1; Max-Age=1; Path=/', 'http://x.test/')
  jar.setCookie('b=2; Max-Age=3600; Path=/', 'http://x.test/')
  assert.ok(jar.getCookieString('http://x.test/').indexOf('b=2') !== -1)
  await new Promise(function (resolve) {
    setTimeout(resolve, 1100)
  })
  jar.getCookieString('http://x.test/')
  assert.strictEqual(jar._jar._cookies.length, 1, 'only the still-valid cookie remains')
  assert.strictEqual(jar.getCookieString('http://x.test/'), 'b=2')
})

test('B11: a 304 revalidation keeps the stored content-length and body', async function (t) {
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    if (req.headers['if-none-match'] === '"v1"') {
      res.writeHead(304, { etag: '"v1"', 'content-length': '0' })
      res.end()
      return
    }
    res.writeHead(200, { etag: '"v1"', 'cache-control': 'max-age=0' })
    res.end('hello world')
  })
  t.after(() => closeServer(server))
  const cache = new HttpCache({ ttl: 60000 })

  const one = await request.promise({ uri: 'http://127.0.0.1:' + server.port + '/', cache })
  assert.strictEqual(one.body, 'hello world')
  const two = await request.promise({ uri: 'http://127.0.0.1:' + server.port + '/', cache })
  assert.strictEqual(two.body, 'hello world', 'the 304 must not truncate the cached body')
  assert.strictEqual(String(two.headers['content-length']), '11')
  assert.strictEqual(two.revalidated, true)
  assert.strictEqual(hits, 2)
})

test('B12: eviction drops the least-recently-used URL, not the oldest first insertion', function () {
  const cache = new HttpCache({ maxEntries: 2, ttl: 60000 })
  const self = function (url) {
    return {
      method: 'GET',
      uri: { href: url },
      getHeader: function () { return undefined },
      hasHeader: function () { return false }
    }
  }
  cache.store(self('http://x/a'), { statusCode: 200, headers: {} }, Buffer.from('aaa'))
  cache.store(self('http://x/b'), { statusCode: 200, headers: {} }, Buffer.from('bbb'))
  // Revalidate a (bumps its recency past b).
  cache.refresh(self('http://x/a'), { headers: {} })
  cache.store(self('http://x/c'), { statusCode: 200, headers: {} }, Buffer.from('ccc'))
  assert.ok(cache.lookup(self('http://x/a')), 'the refreshed a must survive')
  assert.ok(!cache.lookup(self('http://x/b')), 'the never-refreshed b must be evicted first')
  assert.ok(cache.lookup(self('http://x/c')))
})

test('B14: request.reset() clears globally registered mocks', async function (t) {
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    res.end('real')
  })
  t.after(() => closeServer(server))

  request.mock.add(/everything/, function () {
    return { statusCode: 200, body: 'mocked' }
  })
  request.reset()

  const response = await request.promise('http://127.0.0.1:' + server.port + '/')
  assert.strictEqual(response.body, 'real')
  assert.strictEqual(hits, 1)
})

test('B20: a 307 redirect of a streamed body fails loudly instead of sending an empty body', async function (t) {
  const target = await createServer(function (req, res) {
    res.end('target')
  })
  t.after(() => closeServer(target))

  const source = await createServer(function (req, res) {
    res.writeHead(307, { location: 'http://127.0.0.1:' + target.port + '/' })
    res.end()
  })
  t.after(() => closeServer(source))

  await assert.rejects(
    request.promise({
      uri: 'http://127.0.0.1:' + source.port + '/',
      method: 'POST',
      followAllRedirects: true,
      body: Readable.from(['streamed body'])
    }),
    /streamed request body has already been consumed/
  )
})

test('B32: an unsupported body type errors instead of sending an empty request', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('never')
  })
  t.after(() => closeServer(server))

  await assert.rejects(
    request.promise({
      uri: 'http://127.0.0.1:' + server.port + '/',
      method: 'POST',
      body: 0
    }),
    /Unsupported request body type/
  )
})

test('B6: an http2 TLS/ALPN stall times out instead of hanging the origin', async function (t) {
  // A TCP server that accepts connections but never completes a TLS
  // handshake: the connecting session must not stay pending forever.
  const sockets = new Set()
  const tcp = net.createServer(function (socket) {
    sockets.add(socket)
    socket.on('close', function () {
      sockets.delete(socket)
    })
  })
  await new Promise(function (resolve) {
    tcp.listen(0, '127.0.0.1', resolve)
  })
  t.after(function () {
    for (const socket of sockets) {
      socket.destroy()
    }
    return new Promise(function (resolve) {
      tcp.close(resolve)
    })
  })

  await assert.rejects(
    request.promise({
      uri: 'https://127.0.0.1:' + tcp.address().port + '/',
      http2: true,
      timeout: 400
    }),
    function (err) {
      return err.code === 'ETIMEDOUT'
    }
  )
})
