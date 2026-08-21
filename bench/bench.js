'use strict'

// Benchmark harness for @zelthr/request.
// Measures throughput of common request patterns against a local server.

const http = require('http')
const request = require('../src')

const ITERATIONS = Number(process.env.BENCH_ITER || 2000)
const CONCURRENCY = Number(process.env.BENCH_CONC || 50)

const JSON_PAYLOAD = JSON.stringify({
  ok: true,
  items: Array.from({ length: 20 }, function (_, i) {
    return { id: i, name: 'item-' + i, tags: ['a', 'b', 'c'] }
  })
})

const BIG_PAYLOAD = 'x'.repeat(64 * 1024)

function createBenchServer () {
  return new Promise(function (resolve) {
    const server = http.createServer(function (req, res) {
      const url = req.url
      if (url === '/json') {
        res.setHeader('content-type', 'application/json')
        res.end(JSON_PAYLOAD)
      } else if (url === '/big') {
        res.setHeader('content-length', BIG_PAYLOAD.length)
        res.end(BIG_PAYLOAD)
      } else if (url === '/echo') {
        let body = ''
        req.on('data', function (c) { body += c })
        req.on('end', function () {
          res.setHeader('content-type', 'application/json')
          res.end(body || '{}')
        })
      } else {
        res.end('ok')
      }
    })
    server.listen(0, '127.0.0.1', function () {
      resolve(server)
    })
  })
}

function timeMs (fn) {
  const start = performance.now()
  return fn().then(function () {
    return performance.now() - start
  })
}

async function benchSequentialGet (base, n) {
  for (let i = 0; i < n; i++) {
    await request.promise(base + '/json', { json: true })
  }
}

async function benchConcurrentGet (base, n, conc) {
  let done = 0
  let next = 0
  const workers = []
  for (let w = 0; w < conc; w++) {
    workers.push((async function () {
      while (next < n) {
        next++
        await request.promise(base + '/json', { json: true })
        done++
      }
    })())
  }
  await Promise.all(workers)
  return done
}

async function benchBigBody (base, n) {
  for (let i = 0; i < n; i++) {
    await request.promise(base + '/big')
  }
}

async function benchPostJson (base, n) {
  for (let i = 0; i < n; i++) {
    await request.promise.post(base + '/echo', {
      json: { hello: 'world', n: i }
    })
  }
}

async function benchStreaming (base, n) {
  const stream = require('stream')
  for (let i = 0; i < n; i++) {
    await new Promise(function (resolve, reject) {
      const sink = new stream.Writable({ write (c, e, cb) { cb() } })
      request(base + '/big').pipe(sink)
      sink.on('finish', resolve)
      sink.on('error', reject)
    })
  }
}

function report (name, ms, count) {
  const rps = (count / (ms / 1000)).toFixed(1)
  const perReq = (ms / count).toFixed(3)
  console.log(
    name.padEnd(28) +
    String(count).padStart(7) + ' reqs  ' +
    ms.toFixed(1).padStart(10) + ' ms  ' +
    rps.padStart(10) + ' req/s  ' +
    perReq.padStart(9) + ' ms/req'
  )
}

async function main () {
  const server = await createBenchServer()
  const base = 'http://127.0.0.1:' + server.address().port
  const smallN = ITERATIONS
  const bigN = Math.max(200, Math.floor(ITERATIONS / 5))

  console.log('iterations=' + smallN + ' concurrency=' + CONCURRENCY)
  console.log('')

  // warmup
  await benchSequentialGet(base, 50)

  let ms
  ms = await timeMs(function () { return benchSequentialGet(base, smallN) })
  report('sequential GET json', ms, smallN)

  ms = await timeMs(function () { return benchConcurrentGet(base, smallN, CONCURRENCY) })
  report('concurrent GET json', ms, smallN)

  ms = await timeMs(function () { return benchBigBody(base, bigN) })
  report('GET 64KB body', ms, bigN)

  ms = await timeMs(function () { return benchPostJson(base, bigN) })
  report('POST json echo', ms, bigN)

  ms = await timeMs(function () { return benchStreaming(base, bigN) })
  report('stream 64KB to sink', ms, bigN)

  await request.closePool()
  server.close()
  console.log('')
  console.log('done')
}

main().catch(function (err) {
  console.error(err)
  process.exit(1)
})
