'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const request = require('../src')
const { createServer, closeServer } = require('./server')

test('cache: true serves fresh responses without hitting the network', async function (t) {
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    res.setHeader('cache-control', 'max-age=60')
    res.end('cached payload')
  })
  t.after(() => closeServer(server))
  t.after(() => request.cache.clear())

  const url = 'http://127.0.0.1:' + server.port + '/'

  const first = await request.promise({ uri: url, cache: true })
  assert.strictEqual(first.body, 'cached payload')
  assert.strictEqual(first.fromCache, undefined)

  const second = await request.promise({ uri: url, cache: true })
  assert.strictEqual(second.body, 'cached payload')
  assert.strictEqual(second.fromCache, true)
  assert.strictEqual(hits, 1)
  assert.strictEqual(request.cache.size, 1)
})

test('cache: true ignores no-store responses', async function (t) {
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    res.setHeader('cache-control', 'no-store')
    res.end('fresh every time')
  })
  t.after(() => closeServer(server))
  t.after(() => request.cache.clear())

  const url = 'http://127.0.0.1:' + server.port + '/'
  await request.promise({ uri: url, cache: true })
  await request.promise({ uri: url, cache: true })
  assert.strictEqual(hits, 2)
  assert.strictEqual(request.cache.size, 0)
})

test('stale entries are revalidated with if-none-match and served on 304', async function (t) {
  let hits = 0
  let seenConditional = false
  const server = await createServer(function (req, res) {
    hits++
    if (req.headers['if-none-match'] === '"v1"') {
      seenConditional = true
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

  const second = await request.promise({ uri: url, cache: true })
  assert.strictEqual(second.body, 'revalidated body')
  assert.strictEqual(second.revalidated, true)
  assert.strictEqual(hits, 2)
  assert.strictEqual(seenConditional, true)
})

test('vary is honored: different header values produce different entries', async function (t) {
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    res.setHeader('vary', 'accept-language')
    res.setHeader('cache-control', 'max-age=60')
    res.end('lang-' + (req.headers['accept-language'] || ''))
  })
  t.after(() => closeServer(server))
  t.after(() => request.cache.clear())

  const url = 'http://127.0.0.1:' + server.port + '/'
  const en = await request.promise({ uri: url, cache: true, headers: { 'accept-language': 'en' } })
  const fr = await request.promise({ uri: url, cache: true, headers: { 'accept-language': 'fr' } })
  const en2 = await request.promise({ uri: url, cache: true, headers: { 'accept-language': 'en' } })
  assert.strictEqual(en.body, 'lang-en')
  assert.strictEqual(fr.body, 'lang-fr')
  assert.strictEqual(en2.fromCache, true)
  assert.strictEqual(hits, 2)
})

test('request.cache.clear() empties the store', async function (t) {
  const server = await createServer(function (req, res) {
    res.setHeader('cache-control', 'max-age=60')
    res.end('body')
  })
  t.after(() => closeServer(server))
  t.after(() => request.cache.clear())

  const url = 'http://127.0.0.1:' + server.port + '/'
  await request.promise({ uri: url, cache: true })
  assert.strictEqual(request.cache.size, 1)
  request.cache.clear()
  assert.strictEqual(request.cache.size, 0)
})

test('POST responses are never cached', async function (t) {
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    res.setHeader('cache-control', 'max-age=60')
    res.end('posted')
  })
  t.after(() => closeServer(server))
  t.after(() => request.cache.clear())

  const url = 'http://127.0.0.1:' + server.port + '/'
  await request.promise({ uri: url, method: 'POST', body: 'x', cache: true })
  await request.promise({ uri: url, method: 'POST', body: 'x', cache: true })
  assert.strictEqual(hits, 2)
  assert.strictEqual(request.cache.size, 0)
})
