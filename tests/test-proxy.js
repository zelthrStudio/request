'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const http = require('http')
const net = require('net')
const request = require('../src')
const { createServer, createHttpsServer, closeServer } = require('./server')

// A minimal proxy that answers absolute-form requests itself and tunnels
// CONNECT requests through to the real target.
function createProxy () {
  const server = http.createServer(function (req, res) {
    res.end('proxy got: ' + req.url)
  })

  server.on('connect', function (req, clientSocket, head) {
    const parts = req.url.split(':')
    const host = parts[0]
    const port = Number(parts[1])
    const serverSocket = net.connect(port, host, function () {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head && head.length) {
        serverSocket.write(head)
      }
      serverSocket.pipe(clientSocket)
      clientSocket.pipe(serverSocket)
    })
    // Tear the tunnel down when either side closes, so the test process can
    // exit once the request is done.
    serverSocket.on('close', function () {
      clientSocket.destroy()
    })
    clientSocket.on('close', function () {
      serverSocket.destroy()
    })
    serverSocket.on('error', function () {
      clientSocket.destroy()
    })
    clientSocket.on('error', function () {
      serverSocket.destroy()
    })
  })

  return new Promise(function (resolve, reject) {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', function () {
      server.port = server.address().port
      resolve(server)
    })
  })
}

test('http request goes through an http proxy with absolute-form', async function (t) {
  const proxy = await createProxy()
  t.after(() => closeServer(proxy))
  const server = await createServer(function (req, res) {
    res.end('origin')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:' + server.port + '/path',
      proxy: 'http://127.0.0.1:' + proxy.port
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 200)
        assert.strictEqual(body, 'proxy got: http://127.0.0.1:' + server.port + '/path')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('https request tunnels through the proxy via CONNECT', async function (t) {
  const proxy = await createProxy()
  t.after(() => closeServer(proxy))
  const server = await createHttpsServer(function (req, res) {
    res.end('through the tunnel')
  })
  t.after(() => closeServer(server))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'https://127.0.0.1:' + server.port + '/',
      proxy: 'http://127.0.0.1:' + proxy.port,
      rejectUnauthorized: false
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(response.statusCode, 200)
        assert.strictEqual(body, 'through the tunnel')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('proxy credentials are sent as proxy-authorization', async function (t) {
  let proxyAuth = null
  const proxyServer = http.createServer(function (req, res) {
    proxyAuth = req.headers['proxy-authorization']
    res.end('proxied')
  })

  await new Promise(function (resolve, reject) {
    proxyServer.once('error', reject)
    proxyServer.listen(0, '127.0.0.1', resolve)
  })
  const proxy = proxyServer.address().port
  t.after(() => closeServer(proxyServer))

  await new Promise(function (resolve, reject) {
    request({
      uri: 'http://127.0.0.1:1/never-used',
      proxy: 'http://puser:ppass@127.0.0.1:' + proxy
    }, function (err, response, body) {
      try {
        assert.ifError(err)
        assert.strictEqual(body, 'proxied')
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
  assert.strictEqual(proxyAuth, 'Basic ' + Buffer.from('puser:ppass').toString('base64'))
})

test('proxy from environment variables', async function (t) {
  const proxy = await createProxy()
  t.after(() => closeServer(proxy))

  process.env.HTTP_PROXY = 'http://127.0.0.1:' + proxy.port
  try {
    await new Promise(function (resolve, reject) {
      request('http://example.invalid/somewhere', function (err, response, body) {
        try {
          assert.ifError(err)
          assert.match(body, /^proxy got: http:\/\/example\.invalid\/somewhere$/)
          resolve()
        } catch (e) {
          reject(e)
        }
      })
    })
  } finally {
    delete process.env.HTTP_PROXY
  }
})
