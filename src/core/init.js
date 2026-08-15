'use strict'

// Modified by zelthrStudio (2026) from the original `request` package
// (Copyright 2010-2012 Mikeal Rogers, Apache License 2.0).

const stream = require('stream')

const helpers = require('../util').helpers
const getProxyFromURI = require('../util').proxy
const { normalizeRetry } = require('../util').retry
const { createDnsCache, defaultDnsCache } = require('../util').dnsCache
const { normalizeCircuitBreaker, normalizeRateLimit } = require('./guard')
const { HttpCache, defaultCache } = require('../cache')
const mime = require('../body').mime

const copy = helpers.copy
const defer = helpers.defer
const caseless = helpers.caseless
const isReadStream = helpers.isReadStream
const isstream = helpers.isstream

// init() sets up the request object. The actual outgoing request is not
// started until start() is called. It is called from the constructor and
// again on redirect.
function initRequest (self, options) {
  if (!options) {
    options = {}
  }
  self.headers = self.headers ? copy(self.headers) : {}

  // Delete headers with value undefined since they break
  // ClientRequest.OutgoingMessage.setHeader.
  for (const headerName of Object.keys(self.headers)) {
    if (typeof self.headers[headerName] === 'undefined') {
      delete self.headers[headerName]
    }
  }

  self._caseless = caseless(self.headers)

  if (!self.method) {
    self.method = options.method || 'GET'
  }
  if (!self.localAddress) {
    self.localAddress = options.localAddress
  }

  self._qs.init(options)

  self.debug(options)

  self.dests = self.dests || []
  self.__isRequestRequest = true

  if (self._retry === undefined) {
    self._retry = normalizeRetry(options.retry)
  }

  // Request coalescing: `dedupe: true` merges concurrent identical
  // GET/HEAD requests onto a single network request.
  if (self._dedupe === undefined) {
    self._dedupe = !!options.dedupe
  }

  // Response schema validation: joi/zod/valibot-style validator or a
  // plain function, applied after the body is parsed.
  if (self._schema === undefined) {
    self._schema = options.schema || null
  }

  if (self._circuitBreaker === undefined) {
    self._circuitBreaker = normalizeCircuitBreaker(options.circuitBreaker)
  }

  if (self._rateLimit === undefined) {
    self._rateLimit = normalizeRateLimit(options.rateLimit)
  }

  if (!self._hooks) {
    self._hooks = { beforeRequest: [], afterResponse: [] }
    if (options.hooks) {
      for (const name of ['beforeRequest', 'afterResponse']) {
        const value = options.hooks[name]
        if (Array.isArray(value)) {
          self._hooks[name] = self._hooks[name].concat(value)
        } else if (typeof value === 'function') {
          self._hooks[name].push(value)
        }
      }
    }
  }

  // Protect against double callback.
  if (!self._callback && self.callback) {
    self._callback = self.callback
    self.callback = function () {
      if (self._callbackCalled) {
        return
      }
      self._callbackCalled = true
      self._callback.apply(self, arguments)
    }
    self.on('error', self.callback.bind())
    self.on('complete', self.callback.bind(self, null))
  }

  // People use this property instead all the time, so support it.
  if (!self.uri && self.url) {
    self.uri = self.url
    delete self.url
  }

  // If there's a baseUrl, then use it as the base URL (i.e. uri must be
  // specified as a relative path and is appended to baseUrl).
  if (self.baseUrl) {
    if (typeof self.baseUrl !== 'string') {
      return self.onRequestError(new Error('options.baseUrl must be a string'))
    }

    if (typeof self.uri !== 'string') {
      return self.onRequestError(new Error('options.uri must be a string when using options.baseUrl'))
    }

    if (self.uri.indexOf('//') === 0 || self.uri.indexOf('://') !== -1) {
      return self.onRequestError(new Error('options.uri must be a path when using options.baseUrl'))
    }

    // Handle all cases to make sure that there's only one slash between
    // baseUrl and uri.
    const baseUrlEndsWithSlash = self.baseUrl.lastIndexOf('/') === self.baseUrl.length - 1
    const uriStartsWithSlash = self.uri.indexOf('/') === 0

    if (baseUrlEndsWithSlash && uriStartsWithSlash) {
      self.uri = self.baseUrl + self.uri.slice(1)
    } else if (baseUrlEndsWithSlash || uriStartsWithSlash) {
      self.uri = self.baseUrl + self.uri
    } else if (self.uri === '') {
      self.uri = self.baseUrl
    } else {
      self.uri = self.baseUrl + '/' + self.uri
    }
    delete self.baseUrl
  }

  // A URI is needed by this point, emit error if we haven't been able to get one.
  if (!self.uri) {
    return self.onRequestError(new Error('options.uri is a required argument'))
  }

  // If a string URI/URL was given, parse it into a URL object.
  if (typeof self.uri === 'string') {
    try {
      self.uri = new URL(self.uri)
    } catch (e) {
      return self.onRequestError(new Error('Invalid URI "' + self.uri + '": ' + e.message))
    }
  }

  if (!(self.uri instanceof URL)) {
    return self.onRequestError(new Error('options.uri must be a string or URL object'))
  }

  if (self.uri.protocol === 'unix:') {
    return self.onRequestError(new Error('`unix://` URL scheme is no longer supported.'))
  }

  if (self.uri.protocol !== 'http:' && self.uri.protocol !== 'https:') {
    return self.onRequestError(new Error('Invalid protocol: ' + self.uri.protocol))
  }

  if (self.strictSSL === false) {
    self.rejectUnauthorized = false
  }

  if (!self.uri.hostname) {
    // Invalid URI: it may generate a lot of bad errors, like 'TypeError:
    // Cannot call method `indexOf` of undefined' in CookieJar. Detect and
    // reject it as soon as possible.
    let message = 'Invalid URI "' + self.uri.href + '"'
    if (Object.keys(options).length === 0) {
      // No option? This can be the sign of a redirect. As this is a case
      // where the user cannot do anything (they didn't call request
      // directly with this URL) they should be warned that it can be caused
      // by a redirection (can save some hair).
      message += '. This can be caused by a crappy redirection.'
    }
    self._error = new Error(message)
    self._errored = true
    self.abort()
    return self.emit('error', self._error)
  }

  if (!Object.prototype.hasOwnProperty.call(self, 'proxy')) {
    self.proxy = getProxyFromURI(self.uri)
  }

  // Normalize proxy into a URL object.
  if (self.proxy && typeof self.proxy === 'string') {
    try {
      self.proxy = new URL(self.proxy)
    } catch (e) {
      return self.onRequestError(new Error('Invalid proxy "' + self.proxy + '": ' + e.message))
    }
  }

  if (self.http2 && self.proxy) {
    return self.onRequestError(new Error('options.http2 is not supported with proxies'))
  }

  self._redirect.onRequest(options)

  self.jar(self._jar || options.jar)

  if (options.form) {
    self.form(options.form)
  }

  if (options.formData) {
    const formData = options.formData
    const requestForm = self.form()
    const appendFormValue = function (key, value) {
      if (value && Object.prototype.hasOwnProperty.call(value, 'value') && Object.prototype.hasOwnProperty.call(value, 'options')) {
        requestForm.append(key, value.value, value.options)
      } else {
        requestForm.append(key, value)
      }
    }
    for (const formKey of Object.keys(formData)) {
      const formValue = formData[formKey]
      if (Array.isArray(formValue)) {
        for (const v of formValue) {
          appendFormValue(formKey, v)
        }
      } else {
        appendFormValue(formKey, formValue)
      }
    }
  }

  if (options.qs) {
    self.qs(options.qs)
  }

  self.path = self.uri.pathname + (self.uri.search || '')
  if (self.path.length === 0) {
    self.path = '/'
  }

  if (options.auth) {
    if (Object.prototype.hasOwnProperty.call(options.auth, 'username')) {
      options.auth.user = options.auth.username
    }
    if (Object.prototype.hasOwnProperty.call(options.auth, 'password')) {
      options.auth.pass = options.auth.password
    }

    self.auth(
      options.auth.user,
      options.auth.pass,
      options.auth.sendImmediately,
      options.auth.bearer
    )
  }

  if (self.gzip && !self.hasHeader('accept-encoding')) {
    // `brotli: true` additionally advertises and decodes Brotli responses.
    self.setHeader('accept-encoding', self.brotli ? 'gzip, deflate, br' : 'gzip, deflate')
  }

  // DNS cache / custom lookup: a `lookup` function handed to the transport,
  // so DNS results are resolved once per TTL instead of per request.
  if (!self.lookup) {
    if (options.dnsCache === true) {
      self.lookup = defaultDnsCache
    } else if (typeof options.dnsCache === 'function') {
      self.lookup = options.dnsCache
    } else if (options.dnsCache) {
      self.lookup = createDnsCache(options.dnsCache)
    } else if (typeof options.lookup === 'function') {
      self.lookup = options.lookup
    }
  }

  // RFC 7234 HTTP cache: `cache: true` uses the shared store, an HttpCache
  // instance or `{ ttl, maxEntries }` creates a dedicated one.
  if (!self._cache && options.cache) {
    if (options.cache === true) {
      self._cache = defaultCache
    } else if (options.cache instanceof HttpCache) {
      self._cache = options.cache
    } else {
      self._cache = new HttpCache(options.cache)
    }
  }

  // Byte counters for throughput timing and progress events. The counters
  // are always tracked; events are only emitted when `progress` is set.
  if (!self._progress) {
    self._progress = { received: 0, total: null, uploaded: 0, uploadedTotal: null, start: performance.now() }
    if (options.progress) {
      self.progress = true
    }
  }

  if (options.maxBytes !== undefined) {
    self.maxBytes = options.maxBytes
  }

  if (self.uri.username && !self.hasHeader('authorization')) {
    // The username/password components of a URL are not decoded by the URL
    // parser; a malformed percent-escape (e.g. "%zz") would throw here and
    // crash the caller synchronously, so surface it as a request error.
    let uriUser
    let uriPass
    try {
      uriUser = decodeURIComponent(self.uri.username)
      uriPass = decodeURIComponent(self.uri.password || '')
    } catch (e) {
      return self.onRequestError(new Error('Invalid percent-encoding in URI credentials: ' + e.message))
    }
    self.auth(uriUser, uriPass, true)
  }

  if (options.json) {
    self.json(options.json)
  }
  if (options.multipart) {
    self.multipart(options.multipart)
  }

  if (options.time) {
    self.timing = true
    // NOTE: elapsedTime is deprecated in favor of .timings.
    self.elapsedTime = self.elapsedTime || 0
  }

  const setContentLength = function () {
    if (self.body && !Buffer.isBuffer(self.body) && ArrayBuffer.isView(self.body)) {
      self.body = Buffer.from(self.body.buffer, self.body.byteOffset, self.body.byteLength)
    }

    if (!self.hasHeader('content-length')) {
      let length
      if (typeof self.body === 'string') {
        length = Buffer.byteLength(self.body)
      } else if (Array.isArray(self.body)) {
        // Buffers are counted in bytes; strings are encoded to UTF-8, so
        // sum byte lengths (not UTF-16 code units) or a non-ASCII body
        // would be truncated mid-character on the wire.
        length = self.body.reduce(function (a, b) {
          return a + (Buffer.isBuffer(b) ? b.length : Buffer.byteLength(String(b), 'utf8'))
        }, 0)
      } else {
        length = self.body && self.body.length
      }

      if (length) {
        self.setHeader('content-length', length)
      } else {
        self.onRequestError(new Error('Argument error, options.body.'))
      }
    }
  }

  if (self.body && !isstream(self.body)) {
    setContentLength()
  }

  self.on('pipe', function (src) {
    if (self.ntick && self._started) {
      self.onRequestError(new Error('You cannot pipe to this stream after the outbound request has started.'))
    }
    self.src = src
    if (isReadStream(src)) {
      if (!self.hasHeader('content-type')) {
        self.setHeader('content-type', mime.lookup(src.path))
      }
    } else {
      if (src.headers) {
        for (const i of Object.keys(src.headers)) {
          if (!self.hasHeader(i)) {
            self.setHeader(i, src.headers[i])
          }
        }
      }
      if (self._json && !self.hasHeader('content-type')) {
        self.setHeader('content-type', 'application/json')
      }
      if (src.method && !self.explicitMethod) {
        self.method = src.method
      }
    }
  })

  defer(function () {
    if (self._aborted) {
      return
    }

    const end = function () {
      if (self._form) {
        if (!self._auth.hasAuth || self._auth.sentAuth) {
          self._form.pipe(self)
        }
      }
      if (self._multipart && self._multipart.chunked) {
        self._multipart.body.pipe(self)
      }
      if (self.body) {
        if (isstream(self.body)) {
          self.body.pipe(self)
        } else if (self.body.getReader || self.body[Symbol.asyncIterator]) {
          // Modern streaming: a web ReadableStream or async iterable body.
          const src = self.body.getReader ? stream.Readable.fromWeb(self.body) : stream.Readable.from(self.body)
          src.pipe(self)
        } else if (typeof self.body === 'string' || Buffer.isBuffer(self.body) || Array.isArray(self.body)) {
          // Replayable bodies are handed directly to the dispatcher in
          // start(); only the content-length still needs setting here.
          setContentLength()
          self._sendRequest()
        } else {
          setContentLength()
          if (Array.isArray(self.body)) {
            self.body.forEach(function (part) {
              self.write(part)
            })
          } else {
            self.write(self.body)
          }
          self.end()
        }
      } else if (self.requestBodyStream) {
        console.warn('options.requestBodyStream is deprecated, please pass the request object to stream.pipe.')
        self.requestBodyStream.pipe(self)
      } else if (!self.src) {
        if (self.method !== 'GET' && typeof self.method !== 'undefined' && !self.hasHeader('content-length')) {
          self.setHeader('content-length', 0)
        }
        self._sendRequest()
      }
    }

    if (self._form && !self.hasHeader('content-length')) {
      // Before ending the request, we had to compute the length of the whole form, asyncly.
      self.setHeader(self._form.getHeaders(), true)
      self._form.getLength(function (err, length) {
        if (!err && !isNaN(length)) {
          self.setHeader('content-length', length)
        }
        end()
      })
    } else {
      end()
    }

    self.ntick = true
  })
}

module.exports = { initRequest }
