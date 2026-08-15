'use strict'

// Security & bug-fix regression tests for the audit findings (report.md).

const { test } = require('node:test')
const assert = require('node:assert')
const { Readable } = require('stream')
const request = require('../src')
const { createServer, closeServer, readBody } = require('./server')

test('H1: cookies are dropped when a redirect crosses hostnames', async function (t) {
  let cookieSeen
  const target = await createServer(function (req, res) {
    cookieSeen = req.headers.cookie
    res.end('target')
  })
  t.after(() => closeServer(target))

  const source = await createServer(function (req, res) {
    // Different hostname ('localhost' vs '127.0.0.1') on the same machine.
    res.writeHead(302, { location: 'http://localhost:' + target.port + '/' })
    res.end()
  })
  t.after(() => closeServer(source))

  await new Promise(function (resolve, reject) {
    request.get({
      uri: 'http://127.0.0.1:' + source.port + '/',
      followAllRedirects: true,
      headers: { cookie: 'sid=secret123' }
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, 'target')
        assert.strictEqual(cookieSeen, undefined)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('H1: jar cookies for the old host are not merged into a new host', async function (t) {
  let cookieSeen
  const target = await createServer(function (req, res) {
    cookieSeen = req.headers.cookie
    res.end('target')
  })
  t.after(() => closeServer(target))

  const source = await createServer(function (req, res) {
    res.writeHead(302, { location: 'http://localhost:' + target.port + '/' })
    res.end()
  })
  t.after(() => closeServer(source))

  const jar = request.jar()
  jar.setCookie('hosta=1; Path=/', 'http://127.0.0.1:' + source.port + '/')

  await new Promise(function (resolve, reject) {
    request.get({
      uri: 'http://127.0.0.1:' + source.port + '/',
      followAllRedirects: true,
      jar
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, 'target')
        assert.strictEqual(cookieSeen, undefined)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('H2: paginate refuses cross-origin next URLs by default', async function (t) {
  let foreignHits = 0
  const foreign = await createServer(function (req, res) {
    foreignHits++
    res.end('{}')
  })
  t.after(() => closeServer(foreign))

  const source = await createServer(function (req, res) {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ items: [1, 2], next: 'http://localhost:' + foreign.port + '/page2' }))
  })
  t.after(() => closeServer(source))

  const items = []
  for await (const item of request.paginate('http://127.0.0.1:' + source.port + '/', {
    paginate: { transform: function (response) { return response.body.items } }, json: true
  })) {
    items.push(item)
  }
  assert.deepStrictEqual(items, [1, 2])
  assert.strictEqual(foreignHits, 0, 'the cross-origin page must never be requested')
})

test('H2: same-origin pagination keeps working', async function (t) {
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    res.setHeader('content-type', 'application/json')
    if (req.url === '/page2') {
      res.end(JSON.stringify({ items: [3, 4] }))
    } else {
      res.end(JSON.stringify({ items: [1, 2], next: '/page2' }))
    }
  })
  t.after(() => closeServer(server))

  const items = []
  for await (const item of request.paginate('http://127.0.0.1:' + server.port + '/', {
    paginate: { transform: function (response) { return response.body.items } }, json: true
  })) {
    items.push(item)
  }
  assert.deepStrictEqual(items, [1, 2, 3, 4])
  assert.strictEqual(hits, 2)
})

test('H2: allowCrossOrigin opts into cross-origin hops', async function (t) {
  let foreignHits = 0
  const foreign = await createServer(function (req, res) {
    foreignHits++
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ items: [9] }))
  })
  t.after(() => closeServer(foreign))

  const source = await createServer(function (req, res) {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ items: [1], next: 'http://localhost:' + foreign.port + '/page2' }))
  })
  t.after(() => closeServer(source))

  const items = []
  for await (const item of request.paginate('http://127.0.0.1:' + source.port + '/', {
    paginate: { allowCrossOrigin: true, transform: function (response) { return response.body.items } }, json: true
  })) {
    items.push(item)
  }
  assert.deepStrictEqual(items, [1, 9])
  assert.strictEqual(foreignHits, 1)
})

test('B10: 308 redirect preserves the POST method and body', async function (t) {
  let receivedMethod
  let receivedBody
  const target = await createServer(function (req, res) {
    receivedMethod = req.method
    readBody(req).then(function (body) {
      receivedBody = body
      res.end('ok')
    })
  })
  t.after(() => closeServer(target))

  const source = await createServer(function (req, res) {
    res.writeHead(308, { location: 'http://127.0.0.1:' + target.port + '/' })
    res.end()
  })
  t.after(() => closeServer(source))

  await new Promise(function (resolve, reject) {
    request.post({
      uri: 'http://127.0.0.1:' + source.port + '/',
      body: 'payload',
      followAllRedirects: true
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, 'ok')
        assert.strictEqual(receivedMethod, 'POST')
        assert.strictEqual(receivedBody, 'payload')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('M1: Set-Cookie values containing a date are not split into garbage cookies', async function (t) {
  const jar = request.jar()
  const server = await createServer(function (req, res) {
    res.setHeader('set-cookie', [
      'a=1; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly',
      'b=2; Path=/'
    ])
    res.end('ok')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request.get({
      uri: 'http://127.0.0.1:' + server.port + '/',
      jar
    }, function (err) {
      try {
        assert.ifError(err)
        const cookies = jar.getCookies('http://127.0.0.1:' + server.port + '/')
        assert.strictEqual(cookies.length, 2)
        const a = cookies.find(function (c) { return c.key === 'a' })
        const b = cookies.find(function (c) { return c.key === 'b' })
        assert.ok(a, 'cookie a must exist')
        assert.ok(b, 'cookie b must exist')
        assert.strictEqual(a.expires.getTime(), Date.parse('Wed, 21 Oct 2026 07:28:00 GMT'))
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('M3: explicit maxBytes aborts an oversized collected body', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('x'.repeat(5000))
  })
  t.after(() => closeServer(server))

  await assert.rejects(request.promise({
    uri: 'http://127.0.0.1:' + server.port + '/',
    maxBytes: 100
  }), /maxBytes/i)
})

test('M8: serialization strips userinfo and set-cookie', async function (t) {
  const server = await createServer(function (req, res) {
    res.setHeader('set-cookie', 's=1; Path=/')
    res.end('ok')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    const req = request.get('http://user:secret@127.0.0.1:' + server.port + '/', function (err, response) {
      try {
        assert.ifError(err)
        const reqJson = JSON.parse(JSON.stringify(req))
        assert.ok(!/user|secret/.test(reqJson.uri), 'uri must not leak userinfo')
        const resJson = JSON.parse(JSON.stringify(response))
        assert.strictEqual(resJson.headers['set-cookie'], undefined)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('M9: malformed percent-encoding in URI credentials errors gracefully', async function (t) {
  await new Promise(function (resolve, reject) {
    request.get({
      uri: 'http://%zz:pass@127.0.0.1:9/'
    }, function (err) {
      try {
        assert.ok(err instanceof Error)
        assert.match(err.message, /percent-encoding/i)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('B9: then() attached after the error rejects instead of hanging', async function (t) {
  const req = request.get('http://127.0.0.1:1/')
  req.on('error', function () {})
  await new Promise(function (resolve) {
    setTimeout(resolve, 100)
  })
  await assert.rejects(req.then(function () {}), /ECONNREFUSED/)
})

test('L2: public-suffix Domain attributes are rejected', function () {
  const jar = request.jar()
  // Poisoning attempts: a subdomain must not be able to set a cookie for a
  // public suffix, nor for a registrable domain it does not control.
  jar.setCookie('evil1=1; Domain=co.uk', 'http://evil.co.uk/')
  jar.setCookie('evil2=1; Domain=com', 'http://a.b.com/')
  jar.setCookie('evil3=1; Domain=com.au', 'http://evil.com.au/')
  // Legitimate sets: the public suffix owner itself, and a normal registrable
  // domain from one of its subdomains.
  jar.setCookie('ok1=1; Domain=co.uk', 'http://co.uk/')
  jar.setCookie('ok2=1; Domain=example.com', 'http://evil.example.com/')
  assert.strictEqual(jar.getCookies('http://co.uk/').length, 1)
  assert.strictEqual(jar.getCookies('http://co.uk/')[0].key, 'ok1')
  assert.strictEqual(jar.getCookies('http://a.b.com/').length, 0)
  assert.strictEqual(jar.getCookies('http://evil.com.au/').length, 0)
  assert.strictEqual(jar.getCookies('http://evil.example.com/').length, 1)
})

test('L5: formData filenames cannot inject multipart headers', async function (t) {
  const server = await createServer(function (req, res) {
    readBody(req).then(function (body) {
      res.end(JSON.stringify({ body }))
    })
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request.post({
      uri: 'http://127.0.0.1:' + server.port + '/',
      formData: {
        file: {
          value: 'content',
          options: {
            filename: 'bad\r\nX-Evil: 1\r\n"name\r\n.txt',
            contentType: 'text/plain'
          }
        }
      }
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        const data = JSON.parse(body)
        assert.ok(!data.body.includes('\r\nX-Evil'), 'no CRLF-injected header line may appear')
        assert.ok(!data.body.includes('\r\n"name'), 'no stray quotes may appear')
        assert.match(data.body, /filename="badX-Evil: 1name.txt"/)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('L5: multipart option keys/values cannot inject headers', async function (t) {
  const server = await createServer(function (req, res) {
    readBody(req).then(function (body) {
      res.end(JSON.stringify({ body }))
    })
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request.post({
      uri: 'http://127.0.0.1:' + server.port + '/',
      multipart: [{
        'content-type': 'text/plain',
        'x-evil\r\nInjected: 1': 'v',
        body: 'first part'
      }]
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        const data = JSON.parse(body)
        assert.ok(!data.body.includes('\r\nInjected'), 'no CRLF-injected header line may appear')
        assert.match(data.body, /x-evilInjected: 1: v/)
        assert.match(data.body, /first part/)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('L6: digest challenge values cannot inject headers', async function (t) {
  // Node's own server refuses to emit a header containing CR/LF, so a raw
  // socket server is used to send the hostile WWW-Authenticate challenge.
  const net = require('net')
  let seenAuthorization
  let connections = 0
  const evil = 'Digest realm="evil realm\r\nX-Evil: 1", nonce="abc123", qop="auth"'
  const server = net.createServer(function (socket) {
    connections++
    socket.once('data', function (chunk) {
      const requestHead = chunk.toString('utf8').split('\r\n')
      const authLine = requestHead.find(function (line) {
        return /^authorization:/i.test(line)
      })
      if (authLine) {
        seenAuthorization = authLine.slice('authorization:'.length).trim()
      }
      if (connections === 1) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: ' + evil + '\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
      } else {
        socket.write('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok')
      }
      socket.end()
    })
  })
  await new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  t.after(function () {
    return new Promise(function (resolve) {
      server.close(resolve)
    })
  })

  await new Promise(function (resolve, reject) {
    request.get({
      uri: 'http://127.0.0.1:' + port + '/',
      auth: { user: 'u', pass: 'p', sendImmediately: false }
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, 'ok')
        assert.ok(seenAuthorization, 'digest re-request must carry Authorization')
        assert.ok(!/\r|\n/.test(seenAuthorization), 'Authorization must contain no CR/LF')
        assert.ok(!seenAuthorization.includes('X-Evil'))
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('B1: multipart with a stream part completes without write-after-end', async function (t) {
  const server = await createServer(function (req, res) {
    readBody(req).then(function (body) {
      res.end(JSON.stringify({ body }))
    })
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request.post({
      uri: 'http://127.0.0.1:' + server.port + '/',
      multipart: [
        { 'content-type': 'text/plain', body: 'first part' },
        { 'content-type': 'text/plain', body: Readable.from(['stream-part-data']) }
      ]
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        const data = JSON.parse(body)
        assert.match(data.body, /first part/)
        assert.match(data.body, /stream-part-data/)
        assert.match(data.body, /--[a-f0-9]+--/)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('B2 + L10: qs bracket arrays, root empty keys and inherited keys', function () {
  const { parse } = require('../src/body/qs')
  assert.deepStrictEqual(parse('a[0]=1&a[1]=2'), { a: ['1', '2'] })
  assert.deepStrictEqual(parse('a[]=1&a[]=2'), { a: ['1', '2'] })
  assert.deepStrictEqual(parse('a[0]=1&a[x]=2'), { a: { 0: '1', x: '2' } })
  assert.deepStrictEqual(parse('toString=1'), { toString: '1' })
  assert.deepStrictEqual(parse('a[toString]=1'), { a: { toString: '1' } })
  assert.doesNotThrow(function () {
    assert.deepStrictEqual(parse('=value'), {})
  })
})

test('B6: malformed max-age falls back instead of being forever stale', async function (t) {
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    res.setHeader('cache-control', 'max-age=abc')
    res.end('cached-body')
  })
  t.after(() => closeServer(server))

  const uri = 'http://127.0.0.1:' + server.port + '/'
  const cache = new (require('../src/cache').HttpCache)({ ttl: 60000 })
  await request.promise({ uri, cache })
  const second = await request.promise({ uri, cache })
  assert.strictEqual(second.body, 'cached-body')
  assert.strictEqual(second.fromCache, true)
  assert.strictEqual(hits, 1)
})

test('cache refresh: a 304 must not clobber the stored content-length', function () {
  const { HttpCache } = require('../src/cache')
  const cache = new HttpCache()
  const fakeSelf = {
    method: 'GET',
    uri: { href: 'http://x.test/' },
    getHeader: function () { return undefined },
    hasHeader: function () { return false }
  }
  cache.store(fakeSelf, {
    statusCode: 200,
    headers: { 'cache-control': 'max-age=60', 'content-type': 'text/plain' }
  }, Buffer.from('hello world'))
  const refreshed = cache.refresh(fakeSelf, {
    headers: { 'content-length': '0', 'content-type': 'text/plain' }
  })
  assert.ok(refreshed)
  assert.strictEqual(refreshed.headers['content-length'], 11)
})

test('B7: request.jar() exposes the runtime (non-Sync) API', function () {
  const jar = request.jar()
  assert.strictEqual(typeof jar.setCookie, 'function')
  assert.strictEqual(typeof jar.getCookieString, 'function')
  assert.strictEqual(typeof jar.getCookies, 'function')
})

test('B8: pool options (maxSockets) are honored without error', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('pooled')
  })
  t.after(() => closeServer(server))

  const body = await request.promise({
    uri: 'http://127.0.0.1:' + server.port + '/',
    pool: { maxSockets: 1 }
  })
  assert.strictEqual(body.body, 'pooled')
})

test('B16: NO_PROXY matches full labels only', function () {
  const getProxy = require('../src/util').proxy
  const url = new URL('http://google.com/')
  const savedNoProxy = process.env.NO_PROXY
  const savedHttpProxy = process.env.HTTP_PROXY
  try {
    process.env.HTTP_PROXY = 'http://proxy:8080'
    process.env.NO_PROXY = 'oogle.com'
    assert.ok(getProxy(url), 'oogle.com must not match google.com')
    process.env.NO_PROXY = 'google.com'
    assert.strictEqual(getProxy(url), null)
    process.env.NO_PROXY = 'google.com,'
    assert.strictEqual(getProxy(url), null, 'empty zones must not match everything')
    process.env.NO_PROXY = ''
    assert.ok(getProxy(url), 'no NO_PROXY -> proxy used')
  } finally {
    if (savedNoProxy === undefined) {
      delete process.env.NO_PROXY
    } else {
      process.env.NO_PROXY = savedNoProxy
    }
    if (savedHttpProxy === undefined) {
      delete process.env.HTTP_PROXY
    } else {
      process.env.HTTP_PROXY = savedHttpProxy
    }
  }
})

test('B19: global regex mock matchers are stateless', async function () {
  request.mock.add(/api/g, function () {
    return { statusCode: 200, body: 'mocked' }
  })
  try {
    const first = await request.promise('http://api.test/1')
    const second = await request.promise('http://api.test/2')
    assert.strictEqual(first.body, 'mocked')
    assert.strictEqual(second.body, 'mocked')
    assert.strictEqual(first.isMock, true)
    assert.strictEqual(second.isMock, true)
  } finally {
    request.mock.clear()
  }
})

test('B24: MIME table covers common extensions', function () {
  const mime = require('../src/body').mime
  assert.strictEqual(mime.lookup('a.yaml'), 'application/yaml')
  assert.strictEqual(mime.lookup('a.yml'), 'application/yaml')
  assert.strictEqual(mime.lookup('a.heic'), 'image/heic')
  assert.strictEqual(mime.lookup('a.m4a'), 'audio/mp4')
  assert.strictEqual(mime.lookup('a.mkv'), 'video/x-matroska')
  assert.strictEqual(mime.lookup('a.mov'), 'video/quicktime')
  assert.strictEqual(mime.lookup('a.ts'), 'video/mp2t')
  assert.strictEqual(mime.lookup('a.map'), 'application/json')
  assert.strictEqual(mime.lookup('a.apng'), 'image/apng')
  assert.strictEqual(mime.lookup('a.flac'), 'audio/flac')
  assert.strictEqual(mime.lookup('a.aac'), 'audio/aac')
  assert.strictEqual(mime.lookup('a.js'), 'text/javascript')
})

test('B26: digest nc increments per nonce', function () {
  const { Auth } = require('../src/core/auth')
  const auth = new Auth({ debug: function () {}, onRequestError: function () {} })
  auth.user = 'u'
  auth.pass = 'p'
  const first = auth.digest('GET', '/', 'Digest realm="r", nonce="n1", qop="auth"')
  const second = auth.digest('GET', '/', 'Digest realm="r", nonce="n1", qop="auth"')
  const ncOf = function (header) {
    return header.match(/nc=(\d+)/)[1]
  }
  assert.notStrictEqual(ncOf(first), ncOf(second))
})

test('helpers: extend/copy never pollute Object.prototype via __proto__', function () {
  const { extend, copy } = require('../src/util').helpers
  const polluted = JSON.parse('{"__proto__": {"polluted": true}}')
  const target = {}
  extend(target, polluted)
  assert.strictEqual({}.polluted, undefined)
  const deepTarget = {}
  extend(true, deepTarget, polluted)
  assert.strictEqual({}.polluted, undefined)
  const copied = copy(polluted)
  assert.strictEqual({}.polluted, undefined)
  assert.strictEqual(copied.polluted, undefined)
})
