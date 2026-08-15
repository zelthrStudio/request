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
// Sessions still mid-connection (TLS/ALPN): tracked separately so
// closeSessions() can destroy them at shutdown.
const pendingSessions = new Set()

// Wall-clock budget for the whole connection phase (TCP + TLS + ALPN). The
// socket-level connectTimeout only covers TCP; a server that accepts TCP
// but never completes the handshake must not leave the connecting promise
// (and every request queued behind it) pending forever.
const CONNECT_WALL_CLOCK_TIMEOUT = 30000

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
      // The socket-level connectTimeout covers the TCP phase. The default
      // 10s must not outlive the caller's own budgets: a tight `timeout` or
      // `http2ConnectTimeout` wins, so a request that would time out anyway
      // fails with a connect-specific error instead of a generic one.
      let connectTimeout = 10000
      if (self.http2ConnectTimeout !== undefined) {
        connectTimeout = Math.min(connectTimeout, self.http2ConnectTimeout)
      }
      if (self.timeout !== undefined) {
        connectTimeout = Math.min(connectTimeout, self.timeout)
      }
      const options = { connectTimeout }
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

      let session = null
      let settled = false
      // An explicit request timeout also bounds the connection phase; a
      // dedicated `http2ConnectTimeout` overrides the 30s wall-clock budget
      // for slow handshakes without timing out the whole request.
      const connectBudget = self.http2ConnectTimeout !== undefined
        ? self.http2ConnectTimeout
        : (self.timeout || CONNECT_WALL_CLOCK_TIMEOUT)
      const connectTimer = setTimeout(function () {
        if (session) {
          try {
            session.destroy()
          } catch (e) {}
        }
        finish(makeTimeoutError(true))
      }, connectBudget)
      const finish = function (err, result) {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(connectTimer)
        if (err) {
          reject(err)
        } else {
          resolve(result)
        }
      }

      try {
        session = http2.connect(self.uri.origin, options)
      } catch (err) {
        clearTimeout(connectTimer)
        reject(err)
        return
      }
      pendingSessions.add(session)
      session.once('close', function () {
        pendingSessions.delete(session)
      })

      session.once('error', function (err) {
        if (sessions.get(key) === session) {
          sessions.delete(key)
        }
        finish(err)
      })
      session.once('close', function () {
        if (sessions.get(key) === session) {
          sessions.delete(key)
        }
        // A close with no preceding error (e.g. destroy before connect):
        // settle the promise so waiters do not hang.
        if (!settled) {
          finish(new Error('HTTP/2 connection closed before it was established'))
        }
      })

      session.once('connect', function () {
        if (self.uri.protocol === 'https:' && session.alpnProtocol === 'http/1.1') {
          // The server only speaks HTTP/1.1; close this session and fall back.
          session.close()
          sessions.delete(key)
          finish(null, { session: null, key, fallback: true })
          return
        }
        sessions.set(key, session)
        finish(null, { session, key, fallback: false })
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
  // Destroy sessions still mid-connection: they have no `.close` to await,
  // and without a destroy the socket would leak at shutdown.
  for (const session of pendingSessions) {
    try {
      session.destroy()
    } catch (e) {}
  }
  pendingSessions.clear()
  for (const value of sessions.values()) {
    // The map may hold in-flight connect promises (no .close method).
    if (typeof value.close === 'function' && !value.closed && !value.destroyed) {
      value.close()
    }
  }
  sessions.clear()
}

module.exports = { dispatch, closeSessions }
