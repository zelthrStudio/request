'use strict'

// Tests for the v1.2.0 reliability features: request deduplication,
// response schema validation, circuit breaker and per-host rate limiting.

const { test } = require('node:test')
const assert = require('node:assert')
const request = require('../src')
const { createServer, closeServer } = require('./server')

function delay (ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

// --- Request deduplication -------------------------------------------------

test('dedupe: concurrent identical GETs coalesce into a single request', async function (t) {
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    res.end('same body')
  })
  t.after(() => closeServer(server))

  const [r1, r2] = await Promise.all([
    request.promise({ uri: 'http://127.0.0.1:' + server.port + '/', dedupe: true }),
    request.promise({ uri: 'http://127.0.0.1:' + server.port + '/', dedupe: true })
  ])
  assert.strictEqual(hits, 1)
  assert.strictEqual(r1.body, 'same body')
  assert.strictEqual(r2.body, 'same body')
  assert.strictEqual(r1.fromDedupe === true || r2.fromDedupe === true, true)
  assert.strictEqual(r1.fromDedupe === true && r2.fromDedupe === true, false)
})

test('dedupe: only idempotent methods coalesce (POST goes through)', async function (t) {
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    res.end('ok')
  })
  t.after(() => closeServer(server))

  await Promise.all([
    request.promise({ uri: 'http://127.0.0.1:' + server.port + '/', method: 'POST', body: 'a', dedupe: true }),
    request.promise({ uri: 'http://127.0.0.1:' + server.port + '/', method: 'POST', body: 'b', dedupe: true })
  ])
  assert.strictEqual(hits, 2)
})

test('dedupe: different URLs are not coalesced', async function (t) {
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    res.end('ok')
  })
  t.after(() => closeServer(server))

  await Promise.all([
    request.promise({ uri: 'http://127.0.0.1:' + server.port + '/a', dedupe: true }),
    request.promise({ uri: 'http://127.0.0.1:' + server.port + '/b', dedupe: true })
  ])
  assert.strictEqual(hits, 2)
})

test('dedupe: an error on the primary propagates to every waiter', async function (t) {
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    req.socket.destroy()
  })
  t.after(() => closeServer(server))

  const results = await Promise.allSettled([
    request.promise({ uri: 'http://127.0.0.1:' + server.port + '/', dedupe: true }),
    request.promise({ uri: 'http://127.0.0.1:' + server.port + '/', dedupe: true })
  ])
  assert.strictEqual(hits, 1)
  assert.strictEqual(results[0].status, 'rejected')
  assert.strictEqual(results[1].status, 'rejected')
  assert.strictEqual(results[0].reason.code, 'ECONNRESET')
  assert.strictEqual(results[1].reason.code, 'ECONNRESET')
})

test('dedupe: HEAD requests coalesce too', async function (t) {
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    res.end()
  })
  t.after(() => closeServer(server))

  await Promise.all([
    request.promise({ uri: 'http://127.0.0.1:' + server.port + '/', method: 'HEAD', dedupe: true }),
    request.promise({ uri: 'http://127.0.0.1:' + server.port + '/', method: 'HEAD', dedupe: true })
  ])
  assert.strictEqual(hits, 1)
})

// --- Schema validation -----------------------------------------------------

test('schema: zod-style parse errors reject the request', async function (t) {
  const server = await createServer(function (req, res) {
    res.end(JSON.stringify({ ok: false }))
  })
  t.after(() => closeServer(server))

  const fakeZod = {
    parse (body) {
      if (!body.ok) {
        throw new Error('ZOD_FAIL')
      }
      return body
    }
  }
  await assert.rejects(
    request.promise({ uri: 'http://127.0.0.1:' + server.port + '/', json: true, schema: fakeZod }),
    /ZOD_FAIL/
  )
})

test('schema: valibot-style safeParse validates and transforms', async function (t) {
  const server = await createServer(function (req, res) {
    res.end(JSON.stringify({ ok: true, n: 1 }))
  })
  t.after(() => closeServer(server))

  const fakeValibot = {
    safeParse (body) {
      if (!body.ok) {
        return { success: false, issues: [{ path: ['ok'], message: 'must be true' }] }
      }
      return { success: true, output: { doubled: body.n * 2 } }
    }
  }
  const good = await request.promise({ uri: 'http://127.0.0.1:' + server.port + '/', json: true, schema: fakeValibot })
  assert.deepStrictEqual(good.body, { doubled: 2 })

  const badServer = await createServer(function (req, res) {
    res.end(JSON.stringify({ ok: false }))
  })
  t.after(() => closeServer(badServer))
  await assert.rejects(
    request.promise({ uri: 'http://127.0.0.1:' + badServer.port + '/', json: true, schema: fakeValibot }),
    /must be true/
  )
})

test('schema: joi-style validate result', async function (t) {
  const server = await createServer(function (req, res) {
    res.end(JSON.stringify({ ok: true }))
  })
  t.after(() => closeServer(server))

  const fakeJoi = {
    validate (body) {
      if (!body.ok) {
        return { error: new Error('joi says no') }
      }
      return { value: 'validated' }
    }
  }
  const good = await request.promise({ uri: 'http://127.0.0.1:' + server.port + '/', json: true, schema: fakeJoi })
  assert.strictEqual(good.body, 'validated')

  const badServer = await createServer(function (req, res) {
    res.end(JSON.stringify({ ok: false }))
  })
  t.after(() => closeServer(badServer))
  await assert.rejects(
    request.promise({ uri: 'http://127.0.0.1:' + badServer.port + '/', json: true, schema: fakeJoi }),
    /joi says no/
  )
})

test('schema: a plain function transforms the body', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('hello')
  })
  t.after(() => closeServer(server))

  const response = await request.promise({
    uri: 'http://127.0.0.1:' + server.port + '/',
    schema: function (body) {
      return body.toUpperCase()
    }
  })
  assert.strictEqual(response.body, 'HELLO')
})

test('schema: callback mode receives the validation error', async function (t) {
  const server = await createServer(function (req, res) {
    res.end('{}')
  })
  t.after(() => closeServer(server))

  const err = await new Promise(function (resolve, reject) {
    request.get({
      uri: 'http://127.0.0.1:' + server.port + '/',
      json: true,
      schema: {
        parse () {
          throw new Error('callback reject')
        }
      }
    }, function (err) {
      if (err) {
        resolve(err)
      } else {
        reject(new Error('expected an error'))
      }
    })
  })
  assert.match(err.message, /callback reject/)
})

// --- Circuit breaker -------------------------------------------------------

test('circuitBreaker: trips after consecutive failures and fails fast', async function (t) {
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    req.socket.destroy()
  })
  t.after(() => closeServer(server))

  const codes = []
  for (let i = 0; i < 3; i++) {
    await new Promise(function (resolve) {
      request.get({
        uri: 'http://127.0.0.1:' + server.port + '/',
        circuitBreaker: { threshold: 2, cooldown: 60000 }
      }, function (err) {
        codes.push(err ? err.code : null)
        resolve()
      })
    })
  }
  assert.deepStrictEqual(codes, ['ECONNRESET', 'ECONNRESET', 'CB_OPEN'])
  assert.strictEqual(hits, 2)
})

test('circuitBreaker: a half-open probe succeeds and closes the circuit', async function (t) {
  let hits = 0
  const server = await createServer(function (req, res) {
    hits++
    if (hits <= 2) {
      req.socket.destroy()
      return
    }
    res.end('recovered')
  })
  t.after(() => closeServer(server))

  const uri = 'http://127.0.0.1:' + server.port + '/'
  const options = { uri, circuitBreaker: { threshold: 2, cooldown: 150 } }

  const attempt = function () {
    return new Promise(function (resolve) {
      request.get(options, function (err, response, body) {
        resolve(err ? err.code : body)
      })
    })
  }

  assert.strictEqual(await attempt(), 'ECONNRESET')
  assert.strictEqual(await attempt(), 'ECONNRESET')
  assert.strictEqual(await attempt(), 'CB_OPEN')
  await delay(200)
  // Probe goes through while the circuit is open and succeeds.
  assert.strictEqual(await attempt(), 'recovered')
  // Circuit is closed again: plain requests work.
  assert.strictEqual(await attempt(), 'recovered')
  assert.strictEqual(hits, 4)
})

test('circuitBreaker: state is keyed per host:port', async function (t) {
  const bad = await createServer(function (req, res) {
    req.socket.destroy()
  })
  const good = await createServer(function (req, res) {
    res.end('fine')
  })
  t.after(() => closeServer(bad))
  t.after(() => closeServer(good))

  const badUri = 'http://127.0.0.1:' + bad.port + '/'
  const goodUri = 'http://127.0.0.1:' + good.port + '/'
  const breaker = { threshold: 1, cooldown: 60000 }

  const failOnce = function (uri) {
    return new Promise(function (resolve) {
      request.get({ uri, circuitBreaker: breaker }, function (err) {
        resolve(err ? err.code : null)
      })
    })
  }
  assert.strictEqual(await failOnce(badUri), 'ECONNRESET')
  assert.strictEqual(await failOnce(badUri), 'CB_OPEN')

  const goodBody = await new Promise(function (resolve) {
    request.get({ uri: goodUri, circuitBreaker: breaker }, function (err, response, body) {
      resolve(err ? err.code : body)
    })
  })
  assert.strictEqual(goodBody, 'fine')
})

// --- Rate limiting ---------------------------------------------------------

test('rateLimit: spaces concurrent requests per host', async function (t) {
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
  // 20 req/s -> one token every 50ms; allow generous timer slack.
  assert.ok(arrivals[1] - arrivals[0] >= 35, 'second request arrived too early')
  assert.ok(arrivals[2] - arrivals[1] >= 35, 'third request arrived too early')
})

test('rateLimit: burst capacity lets concurrent requests through at once', async function (t) {
  const arrivals = []
  const server = await createServer(function (req, res) {
    arrivals.push(Date.now())
    res.end('ok')
  })
  t.after(() => closeServer(server))

  const uri = 'http://127.0.0.1:' + server.port + '/'
  await Promise.all([
    request.promise({ uri, rateLimit: { rate: 1, capacity: 3 } }),
    request.promise({ uri, rateLimit: { rate: 1, capacity: 3 } }),
    request.promise({ uri, rateLimit: { rate: 1, capacity: 3 } })
  ])
  assert.strictEqual(arrivals.length, 3)
  const span = Math.max.apply(null, arrivals) - Math.min.apply(null, arrivals)
  assert.ok(span < 150, 'burst requests should not wait for tokens, span=' + span)
})
