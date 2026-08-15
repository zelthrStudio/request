'use strict'

// Modified by zelthrStudio (2026) from the original `request` package
// (Copyright 2010-2012 Mikeal Rogers, Apache License 2.0).

const stream = require('stream')

const FormData = require('../body').FormData
const Multipart = require('../body').Multipart
const Querystring = require('../body').Querystring
const cookies = require('../cookie')
const helpers = require('../util').helpers
const { requestToJSON } = require('../util').serialization
const { closeDisposableAgent } = require('../transport')

const { Auth } = require('./auth')
const { Redirect } = require('./redirect')
const { initRequest } = require('./init')
const { startRequest, sendRequest, handleRequestError } = require('./start')
const { handleRequestResponse, handleResponseData, handleResponseEnd } = require('./response')

const extend = helpers.extend
const safeStringify = helpers.safeStringify

// Prototype property names are computed once per process (not per request)
// so the constructor's option-vs-prototype split is an O(1) Set lookup.
let reservedNamesCache = null
function getReservedNames () {
  if (!reservedNamesCache) {
    const names = new Set(Object.getOwnPropertyNames(Request.prototype))
    names.add('constructor')
    reservedNamesCache = names
  }
  return reservedNamesCache
}

class Request extends stream.Duplex {
  constructor (options) {
    super({ emitClose: true, allowHalfOpen: true })

    const self = this
    options = options || {}

    self._options = options
    self._qs = new Querystring(self)
    self._auth = new Auth(self)
    self._multipart = new Multipart(self)
    self._redirect = new Redirect(self)

    // AbortController backing abort() and the dispatcher's signal.
    self._controller = new AbortController()
    self._hasWrites = false
    self._retryAttempts = 0

    // Extend the request instance with any non-reserved properties.
    const reserved = getReservedNames()
    const nonReserved = {}
    for (const key of Object.keys(options)) {
      if (!reserved.has(key)) {
        nonReserved[key] = options[key]
      }
    }
    extend(self, nonReserved)

    self.readable = true
    self.writable = true
    if (options.method) {
      self.explicitMethod = true
    }

    self.init(options)
  }

  // Debugging
  static get debug () {
    return (process.env.NODE_DEBUG && /\brequest\b/.test(process.env.NODE_DEBUG)) || this._debug
  }

  static set debug (value) {
    this._debug = value
  }

  debug () {
    if (Request.debug) {
      console.error('REQUEST %s', require('util').format.apply(null, arguments))
    }
  }

  init (options) {
    return initRequest(this, options)
  }

  start () {
    return startRequest(this)
  }

  _sendRequest () {
    return sendRequest(this)
  }

  onRequestError (error) {
    return handleRequestError(this, error)
  }

  onRequestResponse (response) {
    return handleRequestResponse(this, response)
  }

  onResponseData (chunk) {
    return handleResponseData(this, chunk)
  }

  onResponseEnd () {
    return handleResponseEnd(this)
  }

  pipe (dest, opts) {
    const self = this

    if (self.response) {
      if (self._destdata) {
        self.onRequestError(new Error('You cannot pipe after data has been emitted from the response.'))
      } else if (self._ended) {
        self.onRequestError(new Error('You cannot pipe after the response has been ended.'))
      } else {
        self.pipeDest(dest)
        super.pipe(dest, opts)
        return dest
      }
    } else {
      self.dests.push(dest)
      super.pipe(dest, opts)
      return dest
    }
  }

  pipeDest (dest) {
    const self = this
    const response = self.response
    // Called after the response is received.
    if (dest.headers && !dest.headersSent) {
      if (dest.setHeader) {
        for (const i of Object.keys(response.headers)) {
          // If the response content is being decoded, the Content-Encoding
          // header of the response doesn't represent the piped content, so
          // don't pass it.
          if (!self.gzip || i.toLowerCase() !== 'content-encoding') {
            dest.setHeader(i, response.headers[i])
          }
        }
        dest.statusCode = response.statusCode
      } else {
        for (const i of Object.keys(response.headers)) {
          if (!self.gzip || i.toLowerCase() !== 'content-encoding') {
            dest.headers[i] = response.headers[i]
          }
        }
      }
    }
    if (self.pipefilter) {
      self.pipefilter(response, dest)
    }
  }

  qs (q, clobber) {
    const self = this
    let base
    if (!clobber && self.uri.search) {
      base = self._qs.parse(self.uri.search.slice(1))
    } else {
      base = {}
    }

    for (const i of Object.keys(q)) {
      base[i] = q[i]
    }

    const qs = self._qs.stringify(base)

    if (qs === '') {
      return self
    }

    // Set the search component directly so a URL fragment ('#...') is
    // preserved and the query is not swallowed inside it.
    self.uri = new URL(self.uri.href)
    self.uri.search = qs
    self.url = self.uri
    self.path = self.uri.pathname + (self.uri.search || '')

    return self
  }

  form (form) {
    const self = this
    if (form) {
      if (!/^application\/x-www-form-urlencoded\b/.test(self.getHeader('content-type') || '')) {
        self.setHeader('content-type', 'application/x-www-form-urlencoded')
      }
      self.body = (typeof form === 'string')
        ? self._qs.rfc3986(form)
        : self._qs.stringify(form)
      return self
    }
    // Create form-data object.
    self._form = new FormData()
    self._form.on('error', function (err) {
      err.message = 'form-data: ' + err.message
      self.onRequestError(err)
      self.abort()
    })
    return self._form
  }

  multipart (multipart) {
    const self = this

    self._multipart.onRequest(multipart)

    if (!self._multipart.chunked) {
      self.body = self._multipart.body
    }

    return self
  }

  json (val) {
    const self = this

    if (!self.hasHeader('accept')) {
      self.setHeader('accept', 'application/json')
    }

    if (typeof self.jsonReplacer === 'function') {
      self._jsonReplacer = self.jsonReplacer
    }

    self._json = true
    if (typeof val === 'boolean') {
      if (self.body !== undefined) {
        if (!/^application\/x-www-form-urlencoded\b/.test(self.getHeader('content-type') || '')) {
          self.body = safeStringify(self.body, self._jsonReplacer)
        } else {
          self.body = self._qs.rfc3986(self.body)
        }
        if (!self.hasHeader('content-type')) {
          self.setHeader('content-type', 'application/json')
        }
      }
    } else {
      self.body = safeStringify(val, self._jsonReplacer)
      if (!self.hasHeader('content-type')) {
        self.setHeader('content-type', 'application/json')
      }
    }

    if (typeof self.jsonReviver === 'function') {
      self._jsonReviver = self.jsonReviver
    }

    return self
  }

  getHeader (name) {
    const headerName = Object.keys(this.headers).find(function (key) {
      return key.toLowerCase() === name.toLowerCase()
    })
    return headerName === undefined ? undefined : this.headers[headerName]
  }

  hasHeader (name) {
    return Object.keys(this.headers).some(function (key) {
      return key.toLowerCase() === name.toLowerCase()
    })
  }

  setHeader (name, value, merge) {
    if (typeof name === 'object') {
      const headers = name
      for (const key of Object.keys(headers)) {
        if (merge && this.hasHeader(key)) {
          continue
        }
        this.setHeader(key, headers[key])
      }
      return this
    }
    const existing = Object.keys(this.headers).find(function (key) {
      return key.toLowerCase() === name.toLowerCase()
    })
    if (existing !== undefined) {
      delete this.headers[existing]
    }
    this.headers[name] = value
    return this
  }

  removeHeader (name) {
    const existing = Object.keys(this.headers).find(function (key) {
      return key.toLowerCase() === name.toLowerCase()
    })
    if (existing !== undefined) {
      delete this.headers[existing]
    }
  }

  auth (user, pass, sendImmediately, bearer) {
    const self = this

    self._auth.onRequest(user, pass, sendImmediately, bearer)

    return self
  }

  jar (jar) {
    const self = this
    let cookieString

    if (self._redirect.redirectsFollowed === 0) {
      self.originalCookieHeader = self.getHeader('cookie')
    }

    if (!jar) {
      // Disable cookies.
      cookieString = false
      self._disableCookies = true
    } else {
      const targetCookieJar = jar.getCookieString ? jar : cookies.globalJar
      const urihref = self.uri.href
      // Fetch cookies in the specified host.
      if (targetCookieJar) {
        cookieString = targetCookieJar.getCookieString(urihref)
      }
    }

    // If need cookie and cookie is not empty.
    if (cookieString && cookieString.length) {
      // The original Cookie header (from the pre-redirect request) is only
      // merged back in when we are still talking to the same hostname;
      // forwarding it to a different host would leak cookies across sites.
      const sameHost = !self.originalHost || self.uri.hostname === self.originalHost.split(':')[0]
      if (self.originalCookieHeader && sameHost) {
        // Don't overwrite existing Cookie header.
        self.setHeader('cookie', self.originalCookieHeader + '; ' + cookieString)
      } else {
        self.setHeader('cookie', cookieString)
      }
    }
    self._jar = jar
    return self
  }

  write (chunk, enc, cb) {
    if (this._aborted) {
      return
    }
    this._hasWrites = true
    if (!this._started) {
      this.start()
    }
    if (this._bodyStream) {
      return this._bodyStream.write(chunk, enc, cb)
    }
  }

  end (chunk) {
    const self = this
    if (self._aborted) {
      return
    }
    if (chunk) {
      self.write(chunk)
    }
    if (!self._started) {
      self.start()
    }
    if (self._bodyStream) {
      return self._bodyStream.end()
    }
  }

  abort () {
    const self = this
    if (self._aborted) {
      return
    }
    self._aborted = true

    self._controller.abort()
    if (self._bodyStream && !self._bodyStream.destroyed) {
      self._bodyStream.destroy()
    }
    if (self.req && typeof self.req.destroy === 'function') {
      try {
        self.req.destroy()
      } catch (e) {}
    }
    if (self.response) {
      try {
        self.response.destroy()
      } catch (e) {}
    }
    closeDisposableAgent(self, true)

    self.clearTimeout()
    self.emit('abort')
  }

  clearTimeout () {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer)
      this.timeoutTimer = null
    }
  }

  // Promise interface: a Request is a thenable, so it can be awaited or
  // chained with .then()/.catch()/.finally(). It resolves with the response
  // (whose .body is populated) once the response is complete.
  then (onFulfilled, onRejected) {
    const self = this
    return new Promise(function (resolve, reject) {
      if (self._errored) {
        // The request already failed (possibly synchronously, during
        // construction); reject immediately so the promise never hangs.
        reject(self._error || new Error('Request failed'))
        return
      }
      if (self._ended) {
        resolve(self.response)
        return
      }
      if (self._aborted) {
        reject(new Error('Request aborted'))
        return
      }
      // Collect the body so that response.body is available to the caller.
      self._collect = true
      self._chunks = self._chunks || []
      self.once('complete', function () {
        resolve(self.response)
      })
      self.once('error', function (err) {
        reject(err)
      })
      self.once('abort', function () {
        // An error such as ETIMEDOUT is usually emitted right after the
        // abort; wait one tick so the real error wins when there is one.
        setImmediate(function () {
          reject(new Error('Request aborted'))
        })
      })
    }).then(onFulfilled, onRejected)
  }

  catch (onRejected) {
    return this.then(undefined, onRejected)
  }

  finally (handler) {
    return this.then(
      function (value) {
        return Promise.resolve(handler()).then(function () {
          return value
        })
      },
      function (err) {
        return Promise.resolve(handler()).then(function () {
          throw err
        })
      }
    )
  }

  // Stream API
  _read () {
    const source = this.responseContent
    if (source && source.isPaused()) {
      source.resume()
    }
  }

  _write (chunk, enc, cb) {
    this._hasWrites = true
    if (!this._started) {
      this.start()
    }
    if (this._bodyStream) {
      this._bodyStream.write(chunk, enc, cb)
      return
    }
    cb()
  }

  _final (cb) {
    if (!this._started) {
      this.start()
    }
    if (this._bodyStream) {
      this._bodyStream.end()
    }
    cb()
  }
}

Request.prototype.toJSON = requestToJSON

// Exports
module.exports = Request
