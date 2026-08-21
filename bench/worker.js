'use strict'

// Worker for the multi-process benchmark. Runs the library's request
// machinery against the built-in mock transport (no network) for a fixed
// duration and reports the achieved req/s back to the parent.

process.env.NODE_ENV = 'test'

const request = require('../src')

request.mock.add(/.*/, function () {
  return { statusCode: 200, headers: { 'content-type': 'text/plain' }, body: 'ok' }
})

const DURATION = Number(process.env.BENCH_WORKER_MS || 3000)
const CONC = Number(process.env.BENCH_WORKER_CONC || 32)

async function main () {
  // warmup to let V8 JIT the hot path
  for (let i = 0; i < 3000; i++) {
    await request.promise('http://mock.local/warmup')
  }

  // Wait for the parent's synchronized "go" signal so every worker's timed
  // window overlaps fully; this makes the wall-clock aggregate honest.
  if (process.send) {
    await new Promise(function (resolve) {
      process.once('message', function (msg) {
        if (msg === 'go') resolve()
      })
      process.send({ ready: true })
    })
  }

  let done = 0
  const start = performance.now()
  const stopAt = start + DURATION
  const workers = []
  for (let w = 0; w < CONC; w++) {
    workers.push((async function () {
      let local = 0
      while (performance.now() < stopAt) {
        await request.promise('http://mock.local/x')
        local++
      }
      done += local
    })())
  }
  await Promise.all(workers)
  const elapsed = performance.now() - start
  const rps = done / (elapsed / 1000)

  if (process.send) {
    process.send({ rps, done, elapsed })
  } else {
    console.log(JSON.stringify({ rps, done, elapsed }))
  }
}

main().catch(function (err) {
  console.error(err)
  process.exit(1)
})
