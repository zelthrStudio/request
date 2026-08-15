'use strict'

const http = require('http')
const https = require('https')
const http2 = require('http2')
const fs = require('fs')
const path = require('path')

const sslDir = path.join(__dirname, 'ssl', 'ca')

function listen (server, host) {
  return new Promise(function (resolve, reject) {
    server.once('error', reject)
    server.listen(0, host || '127.0.0.1', function () {
      server.port = server.address().port
      resolve(server)
    })
  })
}

function createServer (handler) {
  return listen(http.createServer(handler))
}

function createHttpsServer (handler) {
  const server = https.createServer({
    key: fs.readFileSync(path.join(sslDir, 'server.key')),
    cert: fs.readFileSync(path.join(sslDir, 'server.crt'))
  }, handler)
  return listen(server)
}

// Cleartext HTTP/2 (h2c) server using the http1-compatible handler API.
function createHttp2Server (handler) {
  return listen(http2.createServer(handler))
}

// TLS HTTP/2 server (ALPN 'h2'), also allowing http/1.1 connections.
function createHttpsHttp2Server (handler) {
  const server = http2.createSecureServer({
    key: fs.readFileSync(path.join(sslDir, 'server.key')),
    cert: fs.readFileSync(path.join(sslDir, 'server.crt')),
    allowHTTP1: true
  }, handler)
  return listen(server)
}

function closeServer (server) {
  return new Promise(function (resolve) {
    if (!server) {
      resolve()
      return
    }
    server.close(function () {
      resolve()
    })
    // Close idle keep-alive connections so server.close() can finish promptly.
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections()
    }
    // Also destroy client-side keep-alive sockets that point at this server.
    // On some Node builds the global agent never times those out, which would
    // keep the test process from exiting.
    const port = server.address() && server.address().port
    if (port) {
      destroyFreeSocketsFor(http.globalAgent, port)
      destroyFreeSocketsFor(https.globalAgent, port)
    }
    // Close the undici keep-alive pools the client may have left behind.
    require('../src').closePool()
  })
}

function destroyFreeSocketsFor (agent, port) {
  for (const key of Object.keys(agent.freeSockets)) {
    if (key.indexOf(':' + port + ':') !== -1) {
      for (const socket of agent.freeSockets[key]) {
        socket.destroy()
      }
      delete agent.freeSockets[key]
    }
  }
}

// Collect the full request body.
function readBody (req) {
  return new Promise(function (resolve) {
    const chunks = []
    req.on('data', function (chunk) {
      chunks.push(chunk)
    })
    req.on('end', function () {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
  })
}

module.exports = { createServer, createHttpsServer, createHttp2Server, createHttpsHttp2Server, closeServer, readBody, sslDir }
