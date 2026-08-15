'use strict'

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

const http2 = require('http2')
const { connectOptions, connectSignature } = require('./tls')
const { makeTimeoutError } = require('./errors')
const { writeBody } = require('./body')

// HTTP/2 support using Node's built-in http2 module. Sessions are pooled
// per origin + TLS settings and multiplexed across requests. For https:,
// ALPN negotiates h2 (falling back to HTTP/1.1 when the server only speaks
// http/1.1); for http:, cleartext h2c (prior knowledge) is used.

const sessions = new Map()

const forbiddenHeaders = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'host', 'hostname']

function sessionKey (self) {
  return self.uri.origin + '|' + connectSignature(self, connectOptions(self))
}

function getSession (self) {
  return new Promise(function (resolve, reject) {
    const key = sessionKey(self)
    const existing = sessions.get(key)
    if (existing) {
      // A concurrent request may already be connecting: the map holds a
      // promise until the session is established, so concurrent requests
      // share one connection instead of opening one each.
      if (typeof existing.then === 'function') {
        existing.then(resolve, reject)
        return
      }
      if (!existing.closed && !existing.destroyed) {
        resolve({ session: existing, key, fallback: false })
        return
      }
    }

    const connecting = new Promise(function (resolve, reject) {
      const options = { connectTimeout: 10000 }
      if (self.lookup) {
        options.lookup = self.lookup
      }
      if (self.uri.protocol === 'https:') {
        options.ALPNProtocols = ['h2', 'http/1.1']
        const connect = connectOptions(self)
        for (const name of Object.keys(connect)) {
          options[name] = connect[name]
        }
      }

      let session
      try {
        session = http2.connect(self.uri.origin, options)
      } catch (err) {
        reject(err)
        return
      }

      session.once('error', function () {
        if (sessions.get(key) === session) {
          sessions.delete(key)
        }
      })
      session.once('close', function () {
        if (sessions.get(key) === session) {
          sessions.delete(key)
        }
      })

      session.once('connect', function () {
        if (self.uri.protocol === 'https:' && session.alpnProtocol === 'http/1.1') {
          // The server only speaks HTTP/1.1; close this session and fall back.
          session.close()
          sessions.delete(key)
          resolve({ session: null, key, fallback: true })
          return
        }
        sessions.set(key, session)
        resolve({ session, key, fallback: false })
      })

      session.once('error', function (err) {
        reject(err)
      })
    })

    // Publish the in-flight promise immediately; replace it with the real
    // session (or drop it) when the connection settles.
    sessions.set(key, connecting)
    connecting.then(function (result) {
      if (result.session) {
        sessions.set(key, result.session)
      }
    }, function () {
      sessions.delete(key)
    })
    connecting.then(resolve, reject)
  })
}

function h2Headers (self) {
  const headers = {
    ':method': self.method.toUpperCase(),
    ':scheme': self.uri.protocol.slice(0, -1),
    ':authority': self.uri.host,
    ':path': self.uri.pathname + (self.uri.search || '')
  }
  if (headers[':path'] === '') {
    headers[':path'] = '/'
  }
  for (const name of Object.keys(self.headers)) {
    if (forbiddenHeaders.indexOf(name.toLowerCase()) !== -1) {
      continue
    }
    const value = self.headers[name]
    if (value === undefined) {
      continue
    }
    headers[name.toLowerCase()] = Array.isArray(value) ? value.map(String) : String(value)
  }
  return headers
}

function dispatch (self) {
  return getSession(self).then(function (result) {
    if (result.fallback) {
      return null
    }
    return dispatchStream(self, result.session)
  })
}

function dispatchStream (self, session) {
  return new Promise(function (resolve, reject) {
    let settled = false
    const fail = function (err) {
      if (!settled) {
        settled = true
        reject(err)
      }
    }

    const stream = session.request(h2Headers(self))
    self.req = stream

    if (self.timeout) {
      stream.setTimeout(self.timeout, function () {
        const err = makeTimeoutError(!self._responseReceived)
        stream.destroy(err)
      })
    }

    const signal = self._controller.signal
    if (signal.aborted) {
      stream.destroy()
    } else {
      signal.addEventListener('abort', function () {
        stream.destroy()
      }, { once: true })
    }

    stream.on('response', function (responseHeaders) {
      self._responseReceived = true
      if (self.timing) {
        self.timings.response = performance.now() - self.startTimeNow
      }
      const statusCode = Number(responseHeaders[':status'])
      const headers = {}
      for (const name of Object.keys(responseHeaders)) {
        if (name[0] !== ':') {
          headers[name] = responseHeaders[name]
        }
      }
      const response = stream
      response.statusCode = statusCode
      response.headers = headers
      response.httpVersion = '2.0'
      settled = true
      resolve(response)
    })

    stream.on('error', fail)

    writeBody(self, stream)
  })
}

function closeSessions () {
  for (const value of sessions.values()) {
    // The map may hold in-flight connect promises (no .close method).
    if (typeof value.close === 'function' && !value.closed && !value.destroyed) {
      value.close()
    }
  }
  sessions.clear()
}

module.exports = { dispatch, closeSessions }
