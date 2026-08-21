'use strict'

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

const safeStringify = helpers.safeStringify
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

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
    self._headerNames = new Map()
    self._qs = new Querystring(self)
    self._auth = new Auth(self)
    self._redirect = new Redirect(self)

    self._hasWrites = false
    self._retryAttempts = 0

    const reserved = getReservedNames()
    for (const key of Object.keys(options)) {
      if (!reserved.has(key) && !UNSAFE_KEYS.has(key)) {
        self[key] = options[key]
      }
    }

    self.readable = true
    self.writable = true
    if (options.method) {
      self.explicitMethod = true
    }

    self.init(options)
  }

  get _controller () {
    // Lazily create the AbortController on first use instead of on every
    // request. The mock (no transport) path never touches it, so ordinary
    // requests skip the allocation entirely.
    if (!this._abortController) {
      this._abortController = new AbortController()
    }
    return this._abortController
  }

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
    if (dest.headers && !dest.headersSent) {
      if (dest.setHeader) {
        for (const i of Object.keys(response.headers)) {
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

    if (typeof URLSearchParams !== 'undefined' && q instanceof URLSearchParams) {
      for (const [key, value] of q.entries()) {
        if (base[key] === undefined) {
          base[key] = value
        } else if (Array.isArray(base[key])) {
          base[key].push(value)
        } else {
          base[key] = [base[key], value]
        }
      }
    } else if (q && typeof q === 'object') {
      for (const i of Object.keys(q)) {
        base[i] = q[i]
      }
    }

    const qs = self._qs.stringify(base)

    if (qs === '') {
      if (clobber && self.uri.search) {
        self.uri = new URL(self.uri.href)
        self.uri.search = ''
        self.url = self.uri
        self.path = self.uri.pathname
      }
      return self
    }

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
      if (typeof URLSearchParams !== 'undefined' && form instanceof URLSearchParams) {
        self.body = self._qs.rfc3986(form.toString())
      } else {
        self.body = (typeof form === 'string')
          ? self._qs.rfc3986(form)
          : self._qs.stringify(form)
      }
      return self
    }
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

    if (!self._multipart) {
      self._multipart = new Multipart(self)
    }
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
    const key = this._headerNames.get(String(name).toLowerCase())
    return key === undefined ? undefined : this.headers[key]
  }

  hasHeader (name) {
    return this._headerNames.has(String(name).toLowerCase())
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
    const lower = String(name).toLowerCase()
    if (merge && this._headerNames.has(lower)) {
      return this
    }
    const existing = this._headerNames.get(lower)
    if (existing !== undefined && existing !== name) {
      delete this.headers[existing]
    }
    this._headerNames.set(lower, name)
    this.headers[name] = value
    return this
  }

  removeHeader (name) {
    const lower = String(name).toLowerCase()
    const existing = this._headerNames.get(lower)
    if (existing !== undefined) {
      delete this.headers[existing]
      this._headerNames.delete(lower)
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
      cookieString = false
      self._disableCookies = true
    } else {
      const targetCookieJar = jar.getCookieString ? jar : cookies.globalJar
      const urihref = self.uri.href
      if (targetCookieJar) {
        cookieString = targetCookieJar.getCookieString(urihref)
      }
    }

    if (cookieString && cookieString.length) {
      const sameHost = !self.originalHost || self.uri.hostname === self.originalHost.split(':')[0]
      if (self.originalCookieHeader && sameHost) {
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
    if (this._bodyStream) {
      return this._bodyStream.end()
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

  then (onFulfilled, onRejected) {
    const self = this
    return new Promise(function (resolve, reject) {
      if (self._errored) {
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
      self._collect = true
      self._chunks = self._chunks || []
      self.once('complete', function () {
        resolve(self.response)
      })
      self.once('error', function (err) {
        reject(err)
      })
      self.once('abort', function () {
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

module.exports = Request
