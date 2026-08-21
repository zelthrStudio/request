'use strict'

const { validateWithSchema } = require('../util/schema')
const {
  normalizeCircuitBreaker,
  normalizeRateLimit,
  cbOpen,
  cbRecordFailure,
  cbRecordSuccess,
  rateAcquire
} = require('../core/guard')

const DEFAULT_MAX_REDIRECTS = 10
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

const UNSUPPORTED_OPTIONS = [
  'retry',
  'jar',
  'proxy',
  'cache',
  'paginate',
  'mock',
  'http2',
  'forever',
  'pool',
  'agent',
  'agentOptions',
  'progress',
  'dnsCache',
  'lookup',
  'tunnel',
  'multipart',
  'localAddress',
  'family',
  'strictSSL',
  'rejectUnauthorized',
  'ca',
  'cert',
  'key',
  'pfx',
  'passphrase',
  'ciphers',
  'secureProtocol',
  'secureOptions',
  'checkServerIdentity',
  'brotli',
  'removeRefererHeader',
  'jsonReplacer',
  'useQuerystring',
  'qsParseOptions'
]

const inFlight = new Map()

function makeEmitter (target) {
  const listeners = {}
  target.on = function (event, fn) {
    ;(listeners[event] = listeners[event] || []).push(fn)
    return target
  }
  target.once = function (event, fn) {
    const wrapped = function () {
      target.removeListener(event, wrapped)
      fn.apply(target, arguments)
    }
    wrapped.listener = fn
    return target.on(event, wrapped)
  }
  target.removeListener = function (event, fn) {
    const list = listeners[event]
    if (list) {
      const index = list.indexOf(fn)
      if (index !== -1) {
        list.splice(index, 1)
      }
    }
    return target
  }
  target.emit = function (event) {
    const list = (listeners[event] || []).slice()
    const args = Array.prototype.slice.call(arguments, 1)
    for (const fn of list) {
      fn.apply(target, args)
    }
  }
  return target
}

function stripUserInfo (href) {
  try {
    const url = new URL(href)
    url.username = ''
    url.password = ''
    return url.href
  } catch (e) {
    return href
  }
}

function makeResponse (self, fetchResponse, body) {
  const headers = {}
  const source = fetchResponse.headers
  if (typeof source.forEach === 'function') {
    source.forEach(function (value, name) {
      headers[name] = value
    })
  } else {
    for (const name of Object.keys(source)) {
      headers[name] = source[name]
    }
  }
  const response = {
    statusCode: fetchResponse.status,
    statusMessage: fetchResponse.statusText,
    headers,
    httpVersion: fetchResponse.httpVersion || '2.0',
    body,
    request: self,
    toJSON: function () {
      const out = { statusCode: this.statusCode, headers: {}, body: this.body }
      const sensitive = /authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey/i
      for (const name of Object.keys(this.headers)) {
        if (!sensitive.test(name)) {
          out.headers[name] = this.headers[name]
        }
      }
      if (this.request) {
        out.request = {
          method: this.request.method,
          uri: stripUserInfo(this.request.uri.href),
          headers: {}
        }
        for (const name of Object.keys(this.request.headers)) {
          if (!sensitive.test(name)) {
            out.request.headers[name] = this.request.headers[name]
          }
        }
      }
      return out
    }
  }
  return response
}

function base64Encode (str) {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function isRedirectStatus (status) {
  return REDIRECT_STATUSES.has(status)
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function safeCopy (target, source) {
  for (const key of Object.keys(source)) {
    if (UNSAFE_KEYS.has(key)) {
      continue
    }
    target[key] = source[key]
  }
  return target
}

function isBodyTypeSupported (value) {
  return (
    typeof value === 'string' ||
    value instanceof URLSearchParams ||
    value instanceof FormData ||
    value instanceof Blob ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    value instanceof ReadableStream
  )
}

class WebRequest {
  constructor (options) {
    makeEmitter(this)

    for (const name of UNSUPPORTED_OPTIONS) {
      if (options[name] !== undefined) {
        const err = new Error('The web/edge entry does not support options.' + name + '; use the Node entry ("@zelthr/request") instead')
        err.code = 'EUNSUPPORTED'
        throw err
      }
    }

    this._controller = new AbortController()
    this._aborted = false
    this._errored = false
    this._ended = false
    this._error = null
    this._started = false
    this._timedOut = false
    this._dedupeEntry = null
    this._initError = null

    this.method = (options.method || 'GET').toUpperCase()
    this.headers = {}
    if (options.headers) {
      for (const name of Object.keys(options.headers)) {
        if (options.headers[name] !== undefined) {
          this.setHeader(name, options.headers[name])
        }
      }
    }

    let uri = options.uri !== undefined ? options.uri : options.url
    if (uri === undefined) {
      this._initError = new Error('options.uri is a required argument')
      return
    }
    if (options.baseUrl) {
      if (options.baseUrl instanceof URL) {
        options.baseUrl = options.baseUrl.href
      }
      if (typeof uri !== 'string') {
        this._initError = new Error('options.uri must be a string when using options.baseUrl')
        return
      }
      try {
        uri = new URL(uri, options.baseUrl).href
      } catch (e) {
        this._initError = new Error('Invalid URI "' + uri + '": ' + e.message)
        return
      }
    }
    try {
      this.uri = typeof uri === 'string' ? new URL(uri) : new URL(uri.href)
    } catch (e) {
      this._initError = new Error('Invalid URI "' + (typeof uri === 'string' ? uri : uri.href) + '": ' + e.message)
      return
    }
    if (this.uri.protocol !== 'http:' && this.uri.protocol !== 'https:') {
      this._initError = new Error('Invalid protocol: ' + this.uri.protocol)
      return
    }
    if (!this.uri.hostname) {
      this._initError = new Error('Invalid URI "' + this.uri.href + '"')
      return
    }

    if (options.qs) {
      const params = new URLSearchParams(this.uri.search)
      if (typeof URLSearchParams !== 'undefined' && options.qs instanceof URLSearchParams) {
        for (const [key, value] of options.qs.entries()) {
          params.append(key, value)
        }
      } else if (typeof options.qs === 'object') {
        for (const key of Object.keys(options.qs)) {
          const value = options.qs[key]
          if (Array.isArray(value)) {
            for (const v of value) {
              params.append(key, String(v))
            }
          } else if (value !== undefined && value !== null) {
            params.append(key, String(value))
          }
        }
      }
      this.uri.search = params.toString()
    }

    this.path = this.uri.pathname + (this.uri.search || '')

    if (this.uri.username || this.uri.password) {
      if (!this.hasHeader('authorization')) {
        const user = decodeURIComponent(this.uri.username || '')
        const pass = decodeURIComponent(this.uri.password || '')
        this.setHeader('authorization', 'Basic ' + base64Encode(user + ':' + pass))
      }
      this.uri.username = ''
      this.uri.password = ''
      this.path = this.uri.pathname + (this.uri.search || '')
    }

    this._json = !!options.json
    this._dedupe = !!options.dedupe
    this._schema = options.schema || null
    this._circuitBreaker = normalizeCircuitBreaker(options.circuitBreaker)
    this._rateLimit = normalizeRateLimit(options.rateLimit)
    this._hooks = options.hooks || {}
    this.timeout = options.timeout
    this.encoding = options.encoding !== undefined ? options.encoding : 'utf8'
    this.maxBytes = options.maxBytes
    this.timing = !!options.time
    this.followRedirect = options.followRedirect !== false
    this.followAllRedirects = !!options.followAllRedirects
    this.followOriginalHttpMethod = !!options.followOriginalHttpMethod
    this.maxRedirects = options.maxRedirects === undefined ? DEFAULT_MAX_REDIRECTS : options.maxRedirects

    this._body = this._buildBody(options)
    this._applyAuth(options)
  }

  _buildBody (options) {
    if (options.formData !== undefined && !(options.formData instanceof FormData)) {
      const err = new Error('The web/edge entry only supports options.formData as a FormData instance; pass a FormData object or use the Node entry ("@zelthr/request")')
      err.code = 'EUNSUPPORTED'
      throw err
    }
    if (options.formData instanceof FormData) {
      return { body: options.formData, contentType: null, replayable: true }
    }
    if (options.form) {
      if (typeof options.form === 'string') {
        return { body: options.form, contentType: 'application/x-www-form-urlencoded', replayable: true }
      }
      if (typeof URLSearchParams !== 'undefined' && options.form instanceof URLSearchParams) {
        return { body: options.form.toString(), contentType: 'application/x-www-form-urlencoded', replayable: true }
      }
      const params = new URLSearchParams()
      for (const key of Object.keys(options.form)) {
        const value = options.form[key]
        if (Array.isArray(value)) {
          for (const v of value) {
            params.append(key, String(v))
          }
        } else {
          params.append(key, String(value))
        }
      }
      return { body: params.toString(), contentType: 'application/x-www-form-urlencoded', replayable: true }
    }
    if (options.json && options.json !== true) {
      let value = options.json
      if (typeof value !== 'string') {
        value = JSON.stringify(value)
      }
      return { body: value, contentType: 'application/json', replayable: true }
    }
    if (options.body !== undefined) {
      if (!isBodyTypeSupported(options.body) && !this._initError) {
        const err = new Error('Argument error, options.body.')
        this._initError = err
        return { body: undefined, contentType: null, replayable: false }
      }
      return { body: options.body, contentType: null, replayable: !(options.body instanceof ReadableStream) }
    }
    return { body: undefined, contentType: null, replayable: true }
  }

  _applyAuth (options) {
    const auth = options.auth
    if (!auth || this.hasHeader('authorization')) {
      return
    }
    if (auth.bearer) {
      this.setHeader('authorization', 'Bearer ' + auth.bearer)
      return
    }
    const user = auth.user !== undefined ? auth.user : auth.username
    const pass = auth.pass !== undefined ? auth.pass : auth.password
    if (user !== undefined && user !== null) {
      this.setHeader('authorization', 'Basic ' + base64Encode(user + ':' + (pass || '')))
    }
  }

  setHeader (name, value, merge) {
    if (typeof name === 'object') {
      for (const key of Object.keys(name)) {
        this.setHeader(key, name[key], merge)
      }
      return this
    }
    const lower = name.toLowerCase()
    if (value === undefined) {
      delete this.headers[lower]
      return this
    }
    if (merge && this.headers[lower] !== undefined) {
      this.headers[lower] = [].concat(this.headers[lower], value)
    } else {
      this.headers[lower] = value
    }
    return this
  }

  getHeader (name) {
    return this.headers[name.toLowerCase()]
  }

  hasHeader (name) {
    return this.headers[name.toLowerCase()] !== undefined
  }

  removeHeader (name) {
    delete this.headers[name.toLowerCase()]
    return this
  }

  qs (q, clobber) {
    if (!this.uri) {
      return this
    }
    const params = clobber ? new URLSearchParams() : new URLSearchParams(this.uri.search)
    if (typeof URLSearchParams !== 'undefined' && q instanceof URLSearchParams) {
      for (const [key, value] of q.entries()) {
        params.append(key, value)
      }
    } else if (q && typeof q === 'object') {
      for (const key of Object.keys(q)) {
        const value = q[key]
        if (Array.isArray(value)) {
          for (const v of value) {
            params.append(key, String(v))
          }
        } else if (value !== undefined && value !== null) {
          params.append(key, String(value))
        }
      }
    }
    this.uri.search = params.toString()
    this.path = this.uri.pathname + (this.uri.search || '')
    return this
  }

  form (form) {
    if (form) {
      if (!this.hasHeader('content-type')) {
        this.setHeader('content-type', 'application/x-www-form-urlencoded')
      }
      if (typeof form === 'string') {
        this._body = { body: form, contentType: 'application/x-www-form-urlencoded', replayable: true }
      } else if (typeof URLSearchParams !== 'undefined' && form instanceof URLSearchParams) {
        this._body = { body: form, contentType: 'application/x-www-form-urlencoded', replayable: true }
      } else if (form && typeof form === 'object') {
        const params = new URLSearchParams()
        for (const key of Object.keys(form)) {
          const value = form[key]
          if (Array.isArray(value)) {
            for (const v of value) {
              params.append(key, String(v))
            }
          } else {
            params.append(key, String(value))
          }
        }
        this._body = { body: params.toString(), contentType: 'application/x-www-form-urlencoded', replayable: true }
      }
    }
    return this
  }

  json (val) {
    if (!this.hasHeader('accept')) {
      this.setHeader('accept', 'application/json')
    }
    this._json = true
    if (val !== undefined && val !== true && typeof val !== 'boolean') {
      this._body = { body: typeof val === 'string' ? val : JSON.stringify(val), contentType: 'application/json', replayable: true }
      if (!this.hasHeader('content-type')) {
        this.setHeader('content-type', 'application/json')
      }
    }
    return this
  }

  auth (user, pass, sendImmediately, bearer) {
    if (bearer) {
      this.setHeader('authorization', 'Bearer ' + bearer)
    } else if (user !== undefined && user !== null) {
      this.setHeader('authorization', 'Basic ' + base64Encode(user + ':' + (pass || '')))
    }
    return this
  }

  abort () {
    const self = this
    if (self._aborted) {
      return
    }
    self._aborted = true
    self._controller.abort()
    if (!self._ended && !self._errored) {
      self.emit('abort')
    }
  }

  start () {
    const self = this
    if (self._aborted || self._started) {
      return
    }
    self._started = true
    self.emit('request', self)
    if (self._initError) {
      return self._fail(self._initError)
    }
    queueMicrotask(function () {
      if (!self._aborted) {
        self._attempt(0)
      }
    })
  }

  async _attempt (redirectCount) {
    const self = this
    try {
      self._timedOut = false

      if (self._dedupe && (self.method === 'GET' || self.method === 'HEAD')) {
        if (dedupeAcquire(self)) {
          return
        }
      }

      if (self._circuitBreaker && cbOpen(self)) {
        const err = new Error('Circuit breaker open for ' + self.uri.host)
        err.code = 'CB_OPEN'
        throw err
      }

      if (self._rateLimit) {
        await rateAcquire(self)
      }

      const hooks = self._hooks.beforeRequest
      if (typeof hooks === 'function') {
        await hooks(self)
      } else if (Array.isArray(hooks)) {
        for (const hook of hooks) {
          await hook(self)
        }
      }

      const attemptController = new AbortController()
      const onAbort = function () {
        attemptController.abort()
      }
      self._controller.signal.addEventListener('abort', onAbort)
      let timeoutTimer = null
      if (self.timeout) {
        timeoutTimer = setTimeout(function () {
          self._timedOut = true
          attemptController.abort()
        }, self.timeout)
      }

      const headers = new Headers()
      for (const name of Object.keys(self.headers)) {
        const value = self.headers[name]
        if (Array.isArray(value)) {
          for (const v of value) {
            headers.append(name, v)
          }
        } else {
          headers.append(name, String(value))
        }
      }
      const contentType = self._body.contentType
      if (contentType && !self.hasHeader('content-type')) {
        headers.set('content-type', contentType)
      }

      const startTime = self.timing ? performance.now() : 0
      let fetchResponse
      try {
        fetchResponse = await fetch(self.uri.href, {
          method: self.method,
          headers,
          body: self._body.body,
          redirect: 'manual',
          signal: attemptController.signal
        })
      } catch (err) {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer)
        }
        self._controller.signal.removeEventListener('abort', onAbort)
        if (self._timedOut) {
          const timeoutError = new Error('ESOCKETTIMEDOUT')
          timeoutError.code = 'ETIMEDOUT'
          timeoutError.connect = false
          throw timeoutError
        }
        throw mapFetchError(err)
      }
      let body
      try {
        body = await readBody(self, fetchResponse)
      } catch (err) {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer)
        }
        self._controller.signal.removeEventListener('abort', onAbort)
        if (self._timedOut) {
          const timeoutError = new Error('ESOCKETTIMEDOUT')
          timeoutError.code = 'ETIMEDOUT'
          timeoutError.connect = false
          throw timeoutError
        }
        throw err
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer)
      }
      self._controller.signal.removeEventListener('abort', onAbort)
      let parsedBody = body
      if (self._schema && typeof parsedBody !== 'undefined' && parsedBody !== '') {
        parsedBody = validateWithSchema(self._schema, parsedBody)
      }
      const response = makeResponse(self, fetchResponse, parsedBody)
      self.response = response
      if (self.timing) {
        response.elapsedTime = performance.now() - startTime
        response.timings = { total: response.elapsedTime }
        self.timings = response.timings
      }
      self.emit('response', response)

      if (self._circuitBreaker) {
        cbRecordSuccess(self)
      }

      const redirectTo = self._redirectTarget(response)
      if (redirectTo) {
        if (redirectCount >= self.maxRedirects) {
          throw new Error('Exceeded maxRedirects. Probably stuck in a redirect loop ' + self.uri.href)
        }
        const status = fetchResponse.status
        const convertToGet = (
          status === 303 ||
          ((status === 301 || status === 302) &&
            !self.followOriginalHttpMethod &&
            self.method !== 'GET' &&
            self.method !== 'HEAD')
        )
        if (convertToGet) {
          self.method = 'GET'
          self._body = { body: undefined, contentType: null, replayable: true }
        } else if ((status === 307 || status === 308) && !self._body.replayable) {
          throw new Error('Cannot follow a ' + status + ' redirect when the request body is a stream')
        }
        const currentHost = self.uri.host
        self.uri = new URL(redirectTo)
        if (self.uri.host !== currentHost) {
          self.removeHeader('authorization')
          self.removeHeader('cookie')
        }
        return self._attempt(redirectCount + 1)
      }

      self._finish(response, parsedBody)
    } catch (err) {
      if (self._aborted) {
        return
      }
      if (self._circuitBreaker && err.code !== 'CB_OPEN' && !err.validation) {
        cbRecordFailure(self)
      }
      self._fail(err)
    }
  }

  _redirectTarget (response) {
    const self = this
    const status = response.statusCode
    if (!isRedirectStatus(status)) {
      return null
    }
    const location = response.headers.location
    if (location === undefined) {
      return null
    }
    if (/[<>]/.test(String(location))) {
      return null
    }
    let target
    try {
      target = new URL(location, self.uri)
    } catch (e) {
      throw new Error('Invalid redirect location "' + location + '": ' + e.message)
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return null
    }
    if (typeof self.followRedirect === 'function') {
      return self.followRedirect(response) ? target.href : null
    }
    if (!self.followRedirect) {
      return null
    }
    if (!self.followAllRedirects && self.method !== 'GET' && self.method !== 'HEAD') {
      return null
    }
    return target.href
  }

  _finish (response, body) {
    const self = this
    if (self._ended || self._errored) {
      return
    }
    self._ended = true
    if (self._dedupeEntry) {
      deliverDedupe(self, body)
    }
    self.emit('complete', response, body)
  }

  _fail (err) {
    const self = this
    if (self._aborted || self._ended || self._errored) {
      return
    }
    self._errored = true
    self._error = err
    if (self._dedupeEntry) {
      failDedupe(self, err)
    }
    self.emit('error', err)
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
      self.once('complete', function (response) {
        resolve(response)
      })
      self.once('error', function (err) {
        reject(err)
      })
      self.once('abort', function () {
        setTimeout(function () {
          reject(new Error('Request aborted'))
        }, 0)
      })
    }).then(onFulfilled, onRejected)
  }

  catch (onRejected) {
    return this.then(null, onRejected)
  }

  finally (onFinally) {
    return this.then(function (value) {
      onFinally()
      return value
    }, function (err) {
      onFinally()
      throw err
    })
  }
}

function mapFetchError (err) {
  if (err && err.code) {
    return err
  }
  const mapped = new Error(err && err.message ? err.message : String(err))
  mapped.code = 'ENETWORK'
  mapped.cause = err
  return mapped
}

const ENCODING_ALIASES = {
  latin1: 'windows-1252',
  'iso-8859-1': 'windows-1252',
  'iso8859-1': 'windows-1252',
  ascii: 'windows-1252'
}

async function readBody (self, fetchResponse) {
  if (self.method === 'HEAD' || fetchResponse.status === 204 || fetchResponse.status === 304) {
    return self.encoding === null ? new Uint8Array(0) : ''
  }
  const reader = fetchResponse.body && typeof fetchResponse.body.getReader === 'function'
    ? fetchResponse.body.getReader()
    : null
  let bytes
  if (!reader) {
    const text = await fetchResponse.text()
    bytes = new TextEncoder().encode(text)
  } else {
    const chunks = []
    let total = 0
    const limit = self.maxBytes !== undefined ? self.maxBytes : DEFAULT_MAX_BYTES
    for (;;) {
      const result = await reader.read()
      if (result.done) {
        break
      }
      total += result.value.byteLength
      if (total > limit) {
        await reader.cancel()
        const err = new Error('Response body exceeded the maxBytes limit of ' + limit + ' bytes')
        err.code = 'EBODYLIMIT'
        err.maxBytes = limit
        throw err
      }
      chunks.push(result.value)
    }
    bytes = concatBytes(chunks, total)
  }

  if (self.encoding === null) {
    return bytes
  }
  const isUtf8 = self.encoding === 'utf8' || self.encoding === 'utf-8'
  const label = isUtf8 ? 'utf-8' : (ENCODING_ALIASES[self.encoding] || self.encoding)
  let text = new TextDecoder(label).decode(bytes)
  if (isUtf8 && text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1)
  }
  if (self._json) {
    if (typeof text === 'string' && text !== '') {
      try {
        return JSON.parse(text)
      } catch (e) {
        const err = new Error('Invalid JSON response from ' + self.uri.href + ': ' + e.message)
        err.code = 'EJSONPARSE'
        throw err
      }
    }
  }
  return text
}

function concatBytes (chunks, total) {
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

const DEDUPE_CREDENTIAL_HEADERS = ['authorization', 'cookie']

function dedupeKey (self) {
  let key = self.method + ' ' + self.uri.href
  const parts = []
  for (const name of Object.keys(self.headers)) {
    if (DEDUPE_CREDENTIAL_HEADERS.indexOf(name.toLowerCase()) !== -1) {
      parts.push(name.toLowerCase() + '=' + String(self.headers[name]))
    }
  }
  if (parts.length > 0) {
    key += '&' + parts.sort().join('&')
  }
  return key
}

function dedupeAcquire (self) {
  const key = dedupeKey(self)
  const existing = inFlight.get(key)
  if (existing) {
    existing.waiters.push(self)
    self.once('abort', function () {
      const index = existing.waiters.indexOf(self)
      if (index !== -1) {
        existing.waiters.splice(index, 1)
      }
    })
    return true
  }
  const entry = { key, primary: self, waiters: [] }
  inFlight.set(key, entry)
  self._dedupeEntry = entry
  if (inFlight.size > 1000) {
    inFlight.delete(inFlight.keys().next().value)
  }
  return false
}

function deliverDedupe (primary, body) {
  const entry = primary._dedupeEntry
  if (!entry) {
    return
  }
  primary._dedupeEntry = null
  // Only remove the map slot if it still points at this entry; a newer
  // request may have re-registered under the same key after eviction.
  if (inFlight.get(entry.key) === entry) {
    inFlight.delete(entry.key)
  }
  for (const waiter of entry.waiters) {
    if (waiter._aborted) {
      continue
    }
    try {
      const copy = makeResponse(waiter, primary.response, body)
      copy.fromDedupe = true
      waiter.emit('response', copy)
      waiter._finish(copy, body)
    } catch (err) {
      waiter._fail(err)
    }
  }
}

function failDedupe (primary, err) {
  const entry = primary._dedupeEntry
  if (!entry) {
    return
  }
  primary._dedupeEntry = null
  if (inFlight.get(entry.key) === entry) {
    inFlight.delete(entry.key)
  }
  for (const waiter of entry.waiters) {
    if (!waiter._aborted) {
      waiter._fail(err)
    }
  }
}

function initParams (uri, options, callback) {
  if (typeof options === 'function') {
    callback = options
  }
  const params = {}
  if (options !== null && typeof options === 'object') {
    safeCopy(params, options)
    if (uri !== undefined) {
      params.uri = uri
    }
  } else if (typeof uri === 'string' || uri instanceof URL) {
    params.uri = uri
  } else if (uri && typeof uri === 'object') {
    safeCopy(params, uri)
  }
  params.callback = callback || params.callback
  return params
}

function paramsHaveRequestBody (params) {
  return !!(params.body || params.form || params.json || params.formData)
}

function request (uri, options, callback) {
  if (typeof uri === 'undefined') {
    throw new Error('undefined is not a valid uri or options object.')
  }
  const params = initParams(uri, options, callback)
  if (params.method === 'HEAD' && paramsHaveRequestBody(params)) {
    throw new Error('HTTP HEAD requests MUST NOT include a request body.')
  }
  const req = new WebRequest(params)
  if (params.callback) {
    req.on('error', params.callback)
    req.on('complete', function (response, body) {
      params.callback(null, response, body)
    })
  }
  req.start()
  return req
}

function verbFunc (verb) {
  const method = verb.toUpperCase()
  return function (uri, options, callback) {
    const params = initParams(uri, options, callback)
    params.method = method
    return request(params, params.callback)
  }
}

request.get = verbFunc('get')
request.head = verbFunc('head')
request.options = verbFunc('options')
request.post = verbFunc('post')
request.put = verbFunc('put')
request.patch = verbFunc('patch')
request.del = verbFunc('delete')
request.delete = verbFunc('delete')

request.promise = function (uri, options) {
  try {
    return Promise.resolve(request(uri, options))
  } catch (err) {
    return Promise.reject(err)
  }
}

function promiseVerbFunc (verb) {
  const method = verb.toUpperCase()
  return function (uri, options) {
    const params = initParams(uri, options)
    params.method = method
    delete params.callback
    return request.promise(params)
  }
}

request.promise.get = promiseVerbFunc('get')
request.promise.head = promiseVerbFunc('head')
request.promise.options = promiseVerbFunc('options')
request.promise.post = promiseVerbFunc('post')
request.promise.put = promiseVerbFunc('put')
request.promise.patch = promiseVerbFunc('patch')
request.promise.del = promiseVerbFunc('delete')
request.promise.delete = promiseVerbFunc('delete')

request.defaults = function (defaultOptions) {
  defaultOptions = defaultOptions || {}
  const merge = function (params) {
    const merged = {}
    safeCopy(merged, defaultOptions)
    safeCopy(merged, params)
    if (defaultOptions.headers && params && params.headers) {
      merged.headers = Object.assign({}, defaultOptions.headers, params.headers)
    } else if (defaultOptions.headers) {
      merged.headers = Object.assign({}, defaultOptions.headers)
    } else if (params && params.headers) {
      merged.headers = Object.assign({}, params.headers)
    }
    return merged
  }
  const apply = function (uri, options, callback) {
    const params = initParams(uri, options, callback)
    return request(merge(params), params.callback)
  }
  const verbs = ['get', 'head', 'options', 'post', 'put', 'patch', 'del', 'delete']
  for (const verb of verbs) {
    apply[verb] = function (uri, options, callback) {
      const params = initParams(uri, options, callback)
      params.method = verb === 'del' ? 'DELETE' : verb.toUpperCase()
      return request(merge(params), params.callback)
    }
  }
  apply.promise = function (uri, options) {
    const params = initParams(uri, options)
    delete params.callback
    return request.promise(merge(params))
  }
  for (const verb of verbs) {
    apply.promise[verb] = function (uri, options) {
      const params = initParams(uri, options)
      params.method = verb === 'del' ? 'DELETE' : verb.toUpperCase()
      delete params.callback
      return request.promise(merge(params))
    }
  }
  apply.defaults = function (opts) {
    return request.defaults(merge(opts || {}))
  }
  return apply
}

request.initParams = initParams
request.Request = WebRequest

module.exports = request
