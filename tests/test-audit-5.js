'use strict'

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

const { test } = require('node:test')
const assert = require('node:assert')
const request = require('../src')
const requestWeb = require('../src/web')
const { createServer, closeServer } = require('./server')
const { createDnsCache } = require('../src/util/dns-cache')
const { parse: parseQs } = require('../src/body/qs')

test('request.defaults includes options verb', async function (t) {
  const server = await createServer(function (req, res) {
    res.setHeader('allow', 'GET, POST, OPTIONS')
    res.end('options-ok')
  })
  t.after(async function () {
    await closeServer(server)
  })

  const client = request.defaults({ baseUrl: 'http://127.0.0.1:' + server.port })
  assert.strictEqual(typeof client.options, 'function')

  const res = await client.options('/test-options')
  assert.strictEqual(res.statusCode, 200)
  assert.strictEqual(res.body, 'options-ok')
})

test('request.promise has verb helpers for all methods', async function (t) {
  let lastMethod = ''
  let lastBody = ''
  const server = await createServer(function (req, res) {
    lastMethod = req.method
    let body = ''
    req.on('data', function (c) { body += c })
    req.on('end', function () {
      lastBody = body
      res.end(lastMethod + '-res')
    })
  })
  t.after(async function () {
    await closeServer(server)
  })

  const url = 'http://127.0.0.1:' + server.port + '/path'

  const resGet = await request.promise.get(url)
  assert.strictEqual(resGet.body, 'GET-res')
  assert.strictEqual(lastMethod, 'GET')

  const resPost = await request.promise.post(url, { body: 'hello-post' })
  assert.strictEqual(resPost.body, 'POST-res')
  assert.strictEqual(lastMethod, 'POST')
  assert.strictEqual(lastBody, 'hello-post')

  const resPut = await request.promise.put(url, { body: 'hello-put' })
  assert.strictEqual(resPut.body, 'PUT-res')
  assert.strictEqual(lastMethod, 'PUT')

  const resPatch = await request.promise.patch(url, { body: 'hello-patch' })
  assert.strictEqual(resPatch.body, 'PATCH-res')
  assert.strictEqual(lastMethod, 'PATCH')

  const resDel = await request.promise.del(url)
  assert.strictEqual(resDel.body, 'DELETE-res')
  assert.strictEqual(lastMethod, 'DELETE')

  const resDelete = await request.promise.delete(url)
  assert.strictEqual(resDelete.body, 'DELETE-res')
  assert.strictEqual(lastMethod, 'DELETE')

  const resHead = await request.promise.head(url)
  assert.strictEqual(resHead.statusCode, 200)
  assert.strictEqual(lastMethod, 'HEAD')

  const resOptions = await request.promise.options(url)
  assert.strictEqual(resOptions.body, 'OPTIONS-res')
  assert.strictEqual(lastMethod, 'OPTIONS')
})

test('defaults.promise has verb helpers', async function (t) {
  const server = await createServer(function (req, res) {
    res.end(req.method + ':' + req.url)
  })
  t.after(async function () {
    await closeServer(server)
  })

  const client = request.defaults({ baseUrl: 'http://127.0.0.1:' + server.port })
  assert.strictEqual(typeof client.promise.get, 'function')
  assert.strictEqual(typeof client.promise.post, 'function')

  const res = await client.promise.get('/items')
  assert.strictEqual(res.body, 'GET:/items')

  const resPost = await client.promise.post('/items', { body: '123' })
  assert.strictEqual(resPost.body, 'POST:/items')
})

test('baseUrl accepts a URL instance in Node and Web clients', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('baseUrl-ok:' + req.url)
  })
  t.after(async function () {
    await closeServer(server)
  })

  const baseUrlObj = new URL('http://127.0.0.1:' + server.port + '/api/')

  // Node client
  const nodeRes = await request.promise({ baseUrl: baseUrlObj, uri: 'users' })
  assert.strictEqual(nodeRes.body, 'baseUrl-ok:/api/users')

  // Web client
  const webRes = await requestWeb.promise({ baseUrl: baseUrlObj, uri: 'users' })
  assert.strictEqual(webRes.body, 'baseUrl-ok:/api/users')
})

test('URLSearchParams in qs and form', async function (t) {
  const server = await createServer(function (req, res) {
    let body = ''
    req.on('data', function (c) { body += c })
    req.on('end', function () {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ url: req.url, body, contentType: req.headers['content-type'] }))
    })
  })
  t.after(async function () {
    await closeServer(server)
  })

  const url = 'http://127.0.0.1:' + server.port + '/endpoint'
  const qsParams = new URLSearchParams({ search: 'query text', page: '2' })
  const formParams = new URLSearchParams({ username: 'alice', tag: 'admin' })

  // Node qs with URLSearchParams
  const nodeQs = await request.promise(url, { qs: qsParams, json: true })
  assert.strictEqual(nodeQs.body.url, '/endpoint?search=query%20text&page=2')

  // Node form with URLSearchParams
  const nodeForm = await request.post(url, { form: formParams, json: true })
  assert.strictEqual(nodeForm.body.body, 'username=alice&tag=admin')

  // Web qs with URLSearchParams
  const webQs = await requestWeb.promise(url, { qs: qsParams, json: true })
  assert.strictEqual(webQs.body.url, '/endpoint?search=query+text&page=2')

  // Web form with URLSearchParams
  const webForm = await requestWeb.post(url, { form: formParams, json: true })
  assert.strictEqual(webForm.body.body, 'username=alice&tag=admin')
})

test('qs(q, clobber) with empty q and clobber: true clears search', function () {
  const req = request('http://example.com/test?a=1&b=2')
  assert.strictEqual(req.uri.search, '?a=1&b=2')
  req.qs({}, true)
  assert.strictEqual(req.uri.search, '')
  assert.strictEqual(req.uri.href, 'http://example.com/test')
  assert.strictEqual(req.path, '/test')
})

test('Cookie parser handles SameSite attribute', function () {
  const c1 = request.cookie('session=abc; Path=/; SameSite=Strict; Secure; HttpOnly')
  assert.strictEqual(c1.key, 'session')
  assert.strictEqual(c1.value, 'abc')
  assert.strictEqual(c1.sameSite, 'strict')
  assert.strictEqual(c1.secure, true)
  assert.strictEqual(c1.httpOnly, true)

  const c2 = request.cookie('pref=dark; SameSite=Lax')
  assert.strictEqual(c2.sameSite, 'lax')
})

test('WebRequest fluent chaining methods', async function (t) {
  const server = await createServer(function (req, res) {
    let body = ''
    req.on('data', function (c) { body += c })
    req.on('end', function () {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({
        url: req.url,
        auth: req.headers.authorization,
        contentType: req.headers['content-type'],
        body
      }))
    })
  })
  t.after(async function () {
    await closeServer(server)
  })

  const req = requestWeb('http://127.0.0.1:' + server.port + '/api')
    .qs({ filter: 'active' })
    .auth('user1', 'secret')
    .json(true)

  const res = await req
  assert.strictEqual(res.statusCode, 200)
  assert.strictEqual(res.body.url, '/api?filter=active')
  assert.strictEqual(res.body.auth, 'Basic ' + Buffer.from('user1:secret').toString('base64'))
})

test('Web client defaults nesting and promise verbs', async function (t) {
  const server = await createServer(function (req, res) {
    res.end(req.method + ' ' + req.url + ' ' + (req.headers['x-client'] || ''))
  })
  t.after(async function () {
    await closeServer(server)
  })

  const base = requestWeb.defaults({ baseUrl: 'http://127.0.0.1:' + server.port, headers: { 'x-client': 'zelthr' } })
  const nested = base.defaults({ headers: { 'x-nested': 'true' } })

  assert.strictEqual(typeof base.options, 'function')
  assert.strictEqual(typeof nested.options, 'function')
  assert.strictEqual(typeof base.promise.get, 'function')
  assert.strictEqual(typeof nested.promise.post, 'function')

  const res1 = await base.promise.get('/one')
  assert.strictEqual(res1.body, 'GET /one zelthr')

  const res2 = await nested.promise.post('/two', { body: 'body-data' })
  assert.strictEqual(res2.body, 'POST /two zelthr')
})

test('Web client exports initParams and Request', function () {
  assert.strictEqual(typeof requestWeb.initParams, 'function')
  assert.strictEqual(typeof requestWeb.Request, 'function')

  const params = requestWeb.initParams('http://example.com', { json: true })
  assert.strictEqual(params.uri, 'http://example.com')
  assert.strictEqual(params.json, true)
})

test('createDnsCache handles empty addresses gracefully', function (t, done) {
  const cache = createDnsCache()
  // Lookup a non-existent domain: should return error rather than throw TypeError
  cache('invalid.nonexistent.domain.local.test', { family: 4 }, function (err, addr) {
    assert.ok(err instanceof Error)
    done()
  })
})

test('qs.parse does not create massive sparse arrays on high index', function () {
  const parsed = parseQs('arr[99999]=val')
  assert.strictEqual(typeof parsed.arr, 'object')
  assert.strictEqual(Array.isArray(parsed.arr), false)
  assert.strictEqual(parsed.arr['99999'], 'val')
})
