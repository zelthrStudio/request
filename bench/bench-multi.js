'use strict'

// Multi-process benchmark harness. Spawns N worker processes, each driving
// the library's request machinery against the built-in mock transport, and
// aggregates the achieved requests/second across all workers.
//
// Workers warm up first, then report "ready". The parent waits for every
// worker to be ready and broadcasts "go" so all timed windows overlap fully,
// making the wall-clock aggregate an honest measure.

const { fork } = require('child_process')
const path = require('path')

const PROCS = Number(process.env.BENCH_PROCS || 12)
const WORKER_MS = Number(process.env.BENCH_WORKER_MS || 3000)
const CONC = Number(process.env.BENCH_WORKER_CONC || 32)

function spawnWorker () {
  const child = fork(path.join(__dirname, 'worker.js'), [], {
    env: Object.assign({}, process.env, {
      BENCH_WORKER_MS: String(WORKER_MS),
      BENCH_WORKER_CONC: String(CONC)
    }),
    stdio: ['ignore', 'ignore', 'inherit', 'ipc']
  })

  let resolveReady
  const ready = new Promise(function (resolve) { resolveReady = resolve })

  const result = new Promise(function (resolve, reject) {
    let final = null
    child.on('message', function (msg) {
      if (msg && msg.ready) {
        resolveReady()
        return
      }
      final = msg
    })
    child.on('exit', function (code) {
      if (code === 0 && final) {
        resolve(final)
      } else {
        reject(new Error('worker exited with code ' + code))
      }
    })
    child.on('error', reject)
  })

  return { child, ready, result }
}

async function main () {
  console.log('procs=' + PROCS + ' workerMs=' + WORKER_MS + ' concPerWorker=' + CONC)

  const workers = []
  for (let i = 0; i < PROCS; i++) {
    workers.push(spawnWorker())
  }

  // Wait until every worker has finished warming up, then broadcast 'go'.
  await Promise.all(workers.map(function (w) { return w.ready }))
  const wallStart = performance.now()
  for (const w of workers) {
    w.child.send('go')
  }

  const results = await Promise.all(workers.map(function (w) { return w.result }))
  const wallElapsed = performance.now() - wallStart

  const totalDone = results.reduce(function (a, r) { return a + r.done }, 0)
  const sumRps = results.reduce(function (a, r) { return a + r.rps }, 0)
  const perWorker = results.map(function (r) { return Math.round(r.rps) })

  console.log('per-worker req/s: ' + perWorker.join(', '))
  console.log('total requests:   ' + totalDone)
  console.log('wall time:        ' + wallElapsed.toFixed(0) + ' ms')
  console.log('AGGREGATE:        ' + Math.round(sumRps) + ' req/s')
  console.log('AGGREGATE(wall):  ' + Math.round(totalDone / (wallElapsed / 1000)) + ' req/s')
}

main().catch(function (err) {
  console.error(err)
  process.exit(1)
})
