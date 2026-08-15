'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const request = require('../src')
const { createServer, closeServer } = require('./server')

test('paginates via Link rel="next" headers', async function (t) {
  let page = 0
  const server = await createServer(function (req, res) {
    page++
    res.setHeader('content-type', 'application/json')
    if (page === 1) {
      res.setHeader('link', '<http://127.0.0.1:' + server.port + '/?p=2>; rel="next"')
      res.end(JSON.stringify(['a1', 'a2']))
    } else if (page === 2) {
      res.setHeader('link', '<http://127.0.0.1:' + server.port + '/?p=3>; rel="next"')
      res.end(JSON.stringify(['b1']))
    } else {
      res.end(JSON.stringify(['c1']))
    }
  })
  t.after(() => closeServer(server))

  const items = []
  for await (const item of request.paginate('http://127.0.0.1:' + server.port + '/?p=1', { json: true })) {
    items.push(item)
  }
  assert.deepStrictEqual(items, ['a1', 'a2', 'b1', 'c1'])
})

test('paginates via body.next with a transform', async function (t) {
  let page = 0
  const server = await createServer(function (req, res) {
    page++
    res.setHeader('content-type', 'application/json')
    if (page === 1) {
      res.end(JSON.stringify({ next: '/p2', data: [1, 2] }))
    } else {
      res.end(JSON.stringify({ data: [3] }))
    }
  })
  t.after(() => closeServer(server))

  const items = []
  for await (const item of request.paginate('http://127.0.0.1:' + server.port + '/p1', {
    json: true,
    paginate: {
      transform: function (response) {
        return response.body.data
      }
    }
  })) {
    items.push(item)
  }
  assert.deepStrictEqual(items, [1, 2, 3])
})

test('honors countLimit', async function (t) {
  let requests = 0
  const server = await createServer(function (req, res) {
    requests++
    res.setHeader('content-type', 'application/json')
    res.setHeader('link', '<http://127.0.0.1:' + server.port + '/?p=' + (requests + 1) + '>; rel="next"')
    res.end(JSON.stringify(['a', 'b']))
  })
  t.after(() => closeServer(server))

  const items = []
  for await (const item of request.paginate('http://127.0.0.1:' + server.port + '/?p=1', {
    json: true,
    paginate: { countLimit: 3 }
  })) {
    items.push(item)
  }
  assert.deepStrictEqual(items, ['a', 'b', 'a'])
})

test('honors requestLimit', async function (t) {
  let requests = 0
  const server = await createServer(function (req, res) {
    requests++
    res.setHeader('content-type', 'application/json')
    res.setHeader('link', '<http://127.0.0.1:' + server.port + '/?p=2>; rel="next"')
    res.end(JSON.stringify(['a']))
  })
  t.after(() => closeServer(server))

  const items = []
  for await (const item of request.paginate('http://127.0.0.1:' + server.port + '/?p=1', {
    json: true,
    paginate: { requestLimit: 1 }
  })) {
    items.push(item)
  }
  assert.deepStrictEqual(items, ['a'])
  assert.strictEqual(requests, 1)
})

test('filter and shouldContinue control the iteration', async function (t) {
  let page = 0
  const server = await createServer(function (req, res) {
    page++
    res.setHeader('content-type', 'application/json')
    res.setHeader('link', '<http://127.0.0.1:' + server.port + '/?p=' + (page + 1) + '>; rel="next"')
    res.end(JSON.stringify([1, 2, 3]))
  })
  t.after(() => closeServer(server))

  const items = []
  let calls = 0
  for await (const item of request.paginate('http://127.0.0.1:' + server.port + '/?p=1', {
    json: true,
    paginate: {
      filter: function (n) {
        return n % 2 === 0
      },
      shouldContinue: function (response) {
        calls++
        return calls < 2
      }
    }
  })) {
    items.push(item)
  }
  assert.deepStrictEqual(items, [2, 2])
})
