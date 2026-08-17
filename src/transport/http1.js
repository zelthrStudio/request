'use strict'

const http = require('http')
const https = require('https')

const { getAgent } = require('./pool')
const { makeTimeoutError, makeAbortError, isAbortError } = require('./errors')
const { recordSocketTiming } = require('../util').timing
const { writeBody } = require('./body')
const h2 = require('./http2')

const toBase64 = function (str) {
  return Buffer.from(str || '', 'utf8').toString('base64')
}

function proxyAuthHeader (proxy) {
  if (!proxy || !proxy.username) {
    return null
  }
  try {
    const user = decodeURIComponent(proxy.username)
    const pass = decodeURIComponent(proxy.password || '')
    return 'Basic ' + toBase64(user + ':' + pass)
  } catch (e) {
    return null
  }
}

function buildOptions (self, extraHeaders) {
  const uri = self.uri
  const options = {
    protocol: uri.protocol,
    hostname: uri.hostname,
    port: uri.port || (uri.protocol === 'https:' ? 443 : 80),
    path: self.path || (uri.pathname + (uri.search || '')),
    method: self.method.toUpperCase(),
    headers: extraHeaders || self.headers,
    agent: getAgent(self)
  }

  if (self.localAddress) {
    options.localAddress = self.localAddress
  }

  if (self.lookup) {
    options.lookup = self.lookup
  }

  if (self.family !== undefined) {
    options.family = self.family
  }

  if (uri.protocol === 'https:') {
    const keys = ['ca', 'cert', 'key', 'pfx', 'passphrase', 'ciphers', 'secureProtocol', 'secureOptions', 'rejectUnauthorized', 'checkServerIdentity']
    for (const key of keys) {
      if (self[key] !== undefined) {
        options[key] = self[key]
      }
    }
  }
  return options
}

function proxyRequestOptions (self) {
  const proxy = self.proxy
  const headers = Object.assign({}, self.headers)
  headers.host = self.uri.host
  const auth = proxyAuthHeader(proxy)
  if (auth) {
    headers['proxy-authorization'] = auth
  }
  const options = buildOptions(self, headers)
  options.hostname = proxy.hostname
  options.port = proxy.port || (proxy.protocol === 'https:' ? 443 : 80)
  options.protocol = proxy.protocol
  options.path = self.uri.protocol + '//' + self.uri.host +
    (self.uri.pathname + (self.uri.search || ''))
  return options
}

function connectTunnel (self) {
  return new Promise(function (resolve, reject) {
    const proxy = self.proxy
    const target = self.uri.host
    const headers = { host: target }
    const auth = proxyAuthHeader(proxy)
    if (auth) {
      headers['proxy-authorization'] = auth
    }
    const options = {
      hostname: proxy.hostname,
      port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
      method: 'CONNECT',
      path: target,
      headers,
      agent: false
    }
    const transport = proxy.protocol === 'https:' ? https : http
    const req = transport.request(options)
    req.on('connect', function (res, socket) {
      if (res.statusCode !== 200) {
        socket.destroy()
        reject(new Error('Proxy CONNECT failed with status ' + res.statusCode))
        return
      }
      resolve(socket)
    })
    req.on('error', reject)
    req.end()

    if (self.timeout) {
      req.setTimeout(self.timeout, function () {
        req.destroy(makeTimeoutError(true))
      })
    }

    const signal = self._controller.signal
    if (signal.aborted) {
      req.destroy(makeAbortError())
    } else {
      signal.addEventListener('abort', function () {
        req.destroy(makeAbortError())
      }, { once: true })
    }
  })
}

const socketOwners = new WeakMap()
const handledSockets = new WeakSet()

function attachSocketHandlers (self, req, onSocket) {
  req.on('socket', function (socket) {
    if (onSocket) {
      onSocket(socket)
    }
    if (self.timing) {
      recordSocketTiming(self, socket)
    }
    socketOwners.set(socket, self)
    if (self.timeout) {
      socket.setTimeout(self.timeout)
      if (!handledSockets.has(socket)) {
        handledSockets.add(socket)
        socket.on('timeout', function () {
          const owner = socketOwners.get(socket)
          if (owner && owner.req && !owner.req.destroyed) {
            owner.req.destroy(makeTimeoutError(!owner._responseReceived))
          }
        })
      }
    }
  })
}

function http1Dispatch (self) {
  return new Promise(function (resolve, reject) {
    let req
    let socketRef = null
    let rawSocket = null

    const dispatchDirect = function (options) {
      const transport = options.protocol === 'https:' ? https : http
      req = transport.request(options, function (response) {
        self._responseReceived = true
        if (self.timing) {
          self.timings.response = performance.now() - self.startTimeNow
        }
        response.on('end', function () {
          if (socketRef) {
            socketRef.setTimeout(0)
          }
          if (self._tunneled) {
            if (socketRef && !socketRef.destroyed) {
              socketRef.destroy()
            }
            if (rawSocket && !rawSocket.destroyed) {
              rawSocket.destroy()
            }
          }
        })
        resolve(response)
      })
      self.req = req
      attachSocketHandlers(self, req, function (socket) {
        socketRef = socket
      })
      req.on('error', reject)

      const signal = self._controller.signal
      if (signal.aborted) {
        req.destroy(makeAbortError())
      } else {
        signal.addEventListener('abort', function () {
          req.destroy(makeAbortError())
        }, { once: true })
      }

      writeBody(self, req)
    }

    if (self.proxy && self.uri.protocol === 'http:') {
      dispatchDirect(proxyRequestOptions(self))
    } else if (self.proxy) {
      self._tunneled = true
      connectTunnel(self).then(function (socket) {
        rawSocket = socket
        const options = buildOptions(self, self.headers)
        options.agent = false
        options.createConnection = function () {
          return socket
        }
        dispatchDirect(options)
      }, reject)
    } else {
      dispatchDirect(buildOptions(self, self.headers))
    }
  })
}

function dispatch (self) {
  if (self.http2) {
    return h2.dispatch(self).then(function (result) {
      if (result === null) {
        return http1Dispatch(self)
      }
      return result
    })
  }
  return http1Dispatch(self)
}

module.exports = {
  dispatch,
  isAbortError,
  makeTimeoutError,
  makeAbortError,
  mapTimeoutError: function (err) {
    return err
  }
}
