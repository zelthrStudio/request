'use strict'

// Regression tests for report-2.md (third audit pass):
// - B-H4: pool LRU eviction must destroy evicted agents (fd/socket leak)
// - B-M1: retry defaults exclude PUT/DELETE (duplicate side effects)
// - B-M5: web entry rejects options it cannot honor (silent behavior change)
// - B-M6: guard eviction must never evict an open circuit breaker
// - B-L6: mock enable() warns outside a test environment
// - B-L7: async schema validators are rejected loudly
// - B-L10: connectSignature is stable across calls (hash once per signature)

const { test } = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const request = require('../src')
const { createServer, closeServer, readBody } = require('./server')

// --- B-H4: pool eviction destroys agents --------------------------------

test('B-H4: evicted pooled agents are destroyed (no fd accumulation)', async function (t) {
  // Spy on Agent#destroy: the pool must destroy an agent when it loses its
  // place in the LRU, so its keep-alive sockets (and fds) do not pile up.
  const originalDestroy = http.Agent.prototype.destroy
  let destroyed = 0
  http.Agent.prototype.destroy = function () {
    destroyed++
    return originalDestroy.call(this)
  }
  t.after(function () {
    http.Agent.prototype.destroy = originalDestroy
  })

  const server = await createServer(function (req, res) {
    res.end('ok')
  })
  t.after(() => closeServer(server))

  // 70 distinct `pool` option objects -> 70 dedicated agents; only
  // MAX_CUSTOM_AGENTS (50) survive in the LRU, the other 20 must be
  // destroyed (they are idle after their request completes, so destroying
  // them is safe).
  for (let i = 0; i < 70; i++) {
    await request.promise({
      uri: 'http://127.0.0.1:' + server.port + '/',
      pool: { maxSockets: i + 1 }
    })
  }
  assert.ok(destroyed >= 20, 'expected >= 20 evicted agents to be destroyed, got ' + destroyed)
})

// --- B-M1: retry defaults exclude mutation methods ----------------------

test('B-M1: PUT with a replayable body is not retried by default', async function (t) {
  let attempts = 0
  const server = await createServer(function (req, res) {
    attempts++
    readBody(req).then(function () {
      res.statusCode = 503
      res.end('busy')
    })
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request.put({
      uri: 'http://127.0.0.1:' + server.port + '/',
      body: 'payload',
      retry: { limit: 3, backoff: 1 }
    }, function (err, response) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 503)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
  assert.strictEqual(attempts, 1, 'PUT must not be retried by default')
})

test('B-M1: PUT is retried when methods opts it back in', async function (t) {
  let attempts = 0
  const server = await createServer(function (req, res) {
    attempts++
    readBody(req).then(function () {
      if (attempts === 1) {
        res.statusCode = 503
        res.end('busy')
      } else {
        res.end('done')
      }
    })
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request.put({
      uri: 'http://127.0.0.1:' + server.port + '/',
      body: 'payload',
      retry: { limit: 2, backoff: 1, methods: ['PUT'] }
    }, function (err, response) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 200)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
  assert.strictEqual(attempts, 2)
})

// --- B-M5: web entry rejects unsupported options ------------------------

test('B-M5: web entry rejects unsupported options', async function (t) {
  const webRequest = require('../src/web')
  const options = {
    uri: 'http://127.0.0.1:1/',
    retry: true,
    jar: true,
    proxy: 'http://127.0.0.1:2',
    cache: true,
    paginate: {},
    mock: {},
    http2: true,
    forever: true,
    pool: false,
    agent: new http.Agent()
  }
  for (const name of Object.keys(options)) {
    if (name === 'uri') {
      continue
    }
    await assert.rejects(
      webRequest.promise({ uri: options.uri, [name]: options[name] }),
      function (err) {
        assert.strictEqual(err.code, 'EUNSUPPORTED')
        assert.match(err.message, new RegExp('options\\.' + name))
        return true
      },
      name + ' must be rejected'
    )
  }
})

test('B-M5: web entry rejects plain-object formData', async function () {
  const webRequest = require('../src/web')
  await assert.rejects(
    webRequest.promise({ uri: 'http://127.0.0.1:1/', formData: { a: 'b' } }),
    function (err) {
      assert.strictEqual(err.code, 'EUNSUPPORTED')
      return true
    }
  )
})

// --- B-M6: guard eviction never evicts an open circuit ------------------

test('B-M6: an open circuit survives guard-state eviction', async function (t) {
  const guard = require('../src/core/guard')

  // Drive the breaker map past MAX_STATES with hosts that never open a
  // circuit, then force an open circuit and add more hosts: the open
  // breaker must stay (requests to it must keep failing fast).
  const fillHost = function (i) {
    return '127.0.0.' + Math.floor(i / 250) + ':' + (2000 + (i % 250))
  }
  // 1000 hosts fit; 1100 push the map past the cap (eviction kicks in).
  const openUri = { host: fillHost(0) }
  for (let i = 0; i < 1100; i++) {
    const self = { uri: { host: fillHost(i) }, _circuitBreaker: { threshold: 1, cooldown: 60000 } }
    guard.cbRecordFailure(self)
  }

  // The first host's circuit is open (threshold 1, failed once). Eviction
  // of the oldest entries must skip it.
  assert.strictEqual(guard.cbOpen({ uri: openUri, _circuitBreaker: { threshold: 1, cooldown: 60000 } }), true,
    'the open circuit must survive map eviction')
})

// --- B-L6: mock enable warns outside a test environment -----------------

test('B-L6: mock.enable() warns when NODE_ENV is not test', function (t) {
  const mock = request.mock
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'

  const warnings = []
  const originalWarn = console.warn
  console.warn = function (message) {
    warnings.push(String(message))
  }
  t.after(function () {
    console.warn = originalWarn
    if (previous === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = previous
    }
  })

  mock.enable()
  assert.strictEqual(warnings.length, 1)
  assert.match(warnings[0], /mock/i)
})

test('B-L6: mock.enable() is quiet under NODE_ENV=test', function (t) {
  const mock = request.mock
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'test'

  const warnings = []
  const originalWarn = console.warn
  console.warn = function (message) {
    warnings.push(String(message))
  }
  t.after(function () {
    console.warn = originalWarn
    if (previous === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = previous
    }
  })

  mock.enable()
  assert.strictEqual(warnings.length, 0)
})

// --- B-L7: async schema validators are rejected loudly ------------------

test('B-L7: a schema validator returning a Promise is rejected loudly', async function (t) {
  const server = await createServer(function (req, res) {
    res.end(JSON.stringify({ ok: true }))
  })
  t.after(() => closeServer(server))

  const asyncZod = {
    parse (body) {
      return Promise.resolve(body)
    }
  }
  await assert.rejects(
    request.promise({ uri: 'http://127.0.0.1:' + server.port + '/', json: true, schema: asyncZod }),
    function (err) {
      assert.match(err.message, /must be synchronous/)
      assert.strictEqual(err.validation, true)
      return true
    }
  )
})

test('B-L7: a plain function validator returning a Promise is rejected loudly', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('hello')
  })
  t.after(() => closeServer(server))

  await assert.rejects(
    request.promise({ uri: 'http://127.0.0.1:' + server.port + '/', schema: function () { return Promise.resolve('x') } }),
    /must be synchronous/
  )
})

// --- B-L10: connectSignature is stable per signature --------------------

test('B-L10: connectSignature is deterministic and stable across calls', function () {
  const tls = require('../src/transport/tls')
  const cert = Buffer.from('fake-certificate-bytes-for-signature-stability')

  const self = { ca: cert, rejectUnauthorized: true }
  const connect = tls.connectOptions(self)
  const first = tls.connectSignature(self, connect)
  const second = tls.connectSignature(self, connect)

  assert.strictEqual(first, second)
  assert.ok(first.length > 0)
  assert.match(first, /ca=buf:\d+:[0-9a-f]{64}/)
})
