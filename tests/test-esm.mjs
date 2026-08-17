import { test } from 'node:test'
import assert from 'node:assert'
import request, { get, head, options, post, put, patch, del, defaults, promise, paginate, closePool, cache, mock, reset, Request } from '../src/index.mjs'
import webRequest, { initParams as webInitParams, Request as WebRequestClass } from '../src/web/index.mjs'
import { createServer, closeServer } from './server.js'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const cjs = require('../src/index.js')
const cjsWeb = require('../src/web/index.js')

let server

test('ESM default import equals the CommonJS export', function () {
  assert.strictEqual(request, cjs)
  assert.strictEqual(get, cjs.get)
  assert.strictEqual(head, cjs.head)
  assert.strictEqual(options, cjs.options)
  assert.strictEqual(post, cjs.post)
  assert.strictEqual(put, cjs.put)
  assert.strictEqual(patch, cjs.patch)
  assert.strictEqual(del, cjs.del)
  assert.strictEqual(defaults, cjs.defaults)
  assert.strictEqual(promise, cjs.promise)
  assert.strictEqual(paginate, cjs.paginate)
  assert.strictEqual(cache, cjs.cache)
  assert.strictEqual(mock, cjs.mock)
  assert.strictEqual(reset, cjs.reset)
  assert.strictEqual(closePool, cjs.closePool)
  assert.strictEqual(Request, cjs.Request)

  assert.strictEqual(webRequest, cjsWeb)
  assert.strictEqual(webInitParams, cjsWeb.initParams)
  assert.strictEqual(WebRequestClass, cjsWeb.Request)
})

test('ESM import performs real requests', async function (t) {
  server = await createServer(function (req, res) {
    res.end('esm hello')
  })
  t.after(async function () {
    await closeServer(server)
  })

  const response = await promise('http://127.0.0.1:' + server.port + '/')
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(response.body, 'esm hello')

  const viaGet = await get('http://127.0.0.1:' + server.port + '/')
  assert.strictEqual(viaGet.body, 'esm hello')

  const viaPost = await post({ uri: 'http://127.0.0.1:' + server.port + '/', body: 'x' })
  assert.strictEqual(viaPost.statusCode, 200)
})
