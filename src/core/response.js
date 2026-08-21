'use strict'

const zlib = require('zlib')
const stream = require('stream')

const { responseToJSON } = require('../util').serialization
const { finalizeTimings } = require('../util').timing
const { emitProgress } = require('../util').progress
const cookies = require('../cookie')
const { shouldRetryStatus, retryDelay } = require('../util').retry
const { safeRunAttempt } = require('./start')
const { closeDisposableAgent, makeBodyLimitError } = require('../transport')
const guard = require('./guard')
const { validateWithSchema } = require('../util').schema

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024

async function handleRequestResponse (self, response) {
  if (self._aborted) {
    response.destroy()
    return
  }

  if (self.timing) {
    self.timings.response = performance.now() - self.startTimeNow
  }

  self.debug('onRequestResponse', self.uri.href, response.statusCode, response.headers)

  response.request = self
  response.toJSON = responseToJSON
  self.response = response

  if (self._circuitBreaker) {
    guard.cbRecordSuccess(self)
  }

  if (self._cache && self.method === 'GET' && !self._cacheHit) {
    self._cacheChunks = []
  }

  if (self._progress && self._progress.total === null) {
    const len = response.headers['content-length']
    if (len !== undefined) {
      self._progress.total = Number(len)
    }
  }

  self.originalHost = self.uri.host

  const targetCookieJar = (self._jar && self._jar.setCookie) ? self._jar : cookies.globalJar
  const addCookie = function (cookie) {
    try {
      targetCookieJar.setCookie(cookie, self.uri.href, { ignoreError: true })
    } catch (e) {
      self.emit('error', e)
    }
  }

  const setCookieName = Object.keys(response.headers).find(function (name) {
    return name.toLowerCase() === 'set-cookie'
  })

  if (setCookieName && !self._disableCookies) {
    const splitSetCookies = function (value) {
      if (Array.isArray(value)) {
        return value
      }
      if (response.rawHeaders) {
        const out = []
        for (let i = 0; i < response.rawHeaders.length; i += 2) {
          if (response.rawHeaders[i].toLowerCase() === 'set-cookie') {
            out.push(response.rawHeaders[i + 1])
          }
        }
        if (out.length) {
          return out
        }
      }
      return String(value).split(/,\s*(?=[A-Za-z0-9!#$%&'*+\-.^_`|~]+\s*=)/).filter(Boolean)
    }
    splitSetCookies(response.headers[setCookieName]).forEach(addCookie)
  }

  if (self._redirect.onResponse(response)) {
    return
  }

  if (shouldRetryStatus(self, response.statusCode)) {
    response.on('error', function () {})
    response.destroy()
    self._retryAttempts++
    const delay = retryDelay(self, null, response)
    self.debug('retrying', self.uri.href, response.statusCode, 'in', delay, 'ms')
    return setTimeout(function () {
      safeRunAttempt(self)
    }, delay)
  }

  if (self._cache && self.method === 'GET' && response.statusCode === 304) {
    const entry = self._cache.refresh(self, response)
    if (entry) {
      response.on('error', function () {})
      response.destroy()
      response = self._cache.serve(self, entry)
      response.revalidated = true
      self.response = response
      self._cacheChunks = null
      if (self._progress && self._progress.total === null) {
        const len = response.headers['content-length']
        if (len !== undefined) {
          self._progress.total = Number(len)
        }
      }
    }
  }

  const hooks = self._hooks && self._hooks.afterResponse
  if (hooks && hooks.length) {
    try {
      let replaced = response
      for (const hook of hooks) {
        const hookResult = await hook(replaced)
        if (hookResult) {
          replaced = hookResult
        }
      }
      if (replaced !== response) {
        response = adoptReplacement(self, response, replaced)
        self.response = response
      }
    } catch (err) {
      self.onRequestError(err)
      return
    }
  }

  const noBody = function (code) {
    return (
      self.method === 'HEAD' ||
      (code >= 100 && code < 200) ||
      code === 204 ||
      code === 304
    )
  }

  let responseContent = response
  if (self.gzip && !noBody(response.statusCode)) {
    const contentEncoding = (response.headers['content-encoding'] || 'identity').trim().toLowerCase()

    const zlibOptions = {
      flush: zlib.Z_SYNC_FLUSH,
      finishFlush: zlib.Z_SYNC_FLUSH
    }

    if (contentEncoding === 'gzip') {
      responseContent = zlib.createGunzip(zlibOptions)
      response.pipe(responseContent)
    } else if (contentEncoding === 'deflate') {
      responseContent = zlib.createInflate(zlibOptions)
      response.pipe(responseContent)
    } else if (contentEncoding === 'br' && self.brotli) {
      responseContent = zlib.createBrotliDecompress(zlibOptions)
      response.pipe(responseContent)
    } else {
      if (contentEncoding !== 'identity') {
        self.debug('ignoring unrecognized Content-Encoding ' + contentEncoding)
      }
      responseContent = response
    }
  }

  self.responseContent = responseContent

  self.dests.forEach(function (dest) {
    self.pipeDest(dest)
  })

  self.emit('response', response)

  if (self.encoding && self.dests.length !== 0) {
    console.error('Ignoring encoding parameter as this stream is being piped to another stream which makes the encoding option invalid.')
  }

  if (self.callback) {
    self._collect = true
    self._chunks = []
  }

  responseContent.on('data', function (chunk) {
    self.onResponseData(chunk)
  })
  responseContent.once('end', function () {
    self.onResponseEnd()
  })
  responseContent.on('error', function (error) {
    if (self._aborted) {
      return
    }
    self.emit('error', error)
  })
}

function adoptReplacement (self, oldResponse, replacement) {
  let body = replacement.body
  if (body === undefined) {
    body = ''
  }
  let response
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    response = new stream.Readable({
      read: function () {
        this.push(body)
        this.push(null)
      }
    })
  } else if (body.getReader) {
    response = stream.Readable.fromWeb(body)
  } else if (typeof body.pipe === 'function') {
    response = body
  } else {
    throw new Error('afterResponse hook must return a response whose body is a string, Buffer, or stream')
  }
  response.statusCode = replacement.statusCode !== undefined ? replacement.statusCode : oldResponse.statusCode
  response.headers = replacement.headers || {}
  response.request = self
  response.toJSON = responseToJSON
  return response
}

function handleResponseData (self, chunk) {
  self._destdata = true
  if (self._progress) {
    self._progress.received += chunk.length
    if (self.progress) {
      emitProgress(self, 'download')
    }
  }
  if (self._cacheChunks) {
    const cacheBudget = (self._cache && typeof self._cache.maxBytes === 'number')
      ? self._cache.maxBytes
      : 64 * 1024 * 1024
    const cached = (self._cacheBytes || 0) + chunk.length
    if (cached <= cacheBudget) {
      self._cacheBytes = cached
      self._cacheChunks.push(chunk)
    } else {
      self._cacheChunks = null
      self._cacheBytes = 0
    }
  }
  if (self._collect) {
    const next = (self._collectedBytes || 0) + chunk.length
    const limit = self.maxBytes !== undefined ? self.maxBytes : DEFAULT_MAX_BYTES
    if (next > limit) {
      const err = makeBodyLimitError(limit)
      const content = self.responseContent
      if (content && typeof content.destroy === 'function') {
        content.on('error', function () {})
        content.destroy()
      }
      self.onRequestError(err)
      return
    }
    self._collectedBytes = next
    self._chunks.push(chunk)
  }
  // Only buffer into the readable side when a consumer is (or was) attached.
  // `flowing === null` means nothing ever piped or listened for data, so we
  // skip the push entirely: this keeps the callback/promise path fast and
  // avoids buffering a response nobody reads. When a consumer is present we
  // push and honour backpressure by pausing the source until `_read()`
  // resumes it.
  const readableState = self._readableState
  if (readableState.flowing !== null || readableState.pipesCount > 0) {
    const ok = self.push(chunk)
    if (!ok && self.responseContent && !self.responseContent.isPaused()) {
      self.responseContent.pause()
    }
  }
}

function handleResponseEnd (self) {
  self._ended = true

  if (self.timing) {
    finalizeTimings(self)
  }

  closeDisposableAgent(self, false)

  if (self._aborted) {
    self.debug('aborted', self.uri.href)
    return
  }

  if (self._cache && self._cacheChunks) {
    self._cache.store(self, self.response, Buffer.concat(self._cacheChunks))
    self._cacheChunks = null
  }

  if (self._collect) {
    const response = self.response
    let body
    if (self._chunks.length) {
      // Fast path: a single chunk needs no concat/copy.
      const buf = self._chunks.length === 1 ? self._chunks[0] : Buffer.concat(self._chunks)
      body = self.encoding === null ? buf : buf.toString(self.encoding || 'utf8')
      const isUtf8 = self.encoding === 'utf8' || self.encoding === 'utf-8'
      if (isUtf8 && typeof body === 'string' && body.charCodeAt(0) === 0xFEFF) {
        body = body.slice(1)
      }
    }

    if (self._json) {
      if (typeof body === 'string' && body !== '') {
        try {
          body = JSON.parse(body)
        } catch (e) {
          const err = new Error('Invalid JSON response from ' + self.uri.href + ': ' + e.message)
          err.code = 'EJSONPARSE'
          self.debug('invalid JSON received', self.uri.href)
          self.onRequestError(err)
          return
        }
      }
    }

    if (self._schema && typeof body !== 'undefined' && body !== '') {
      try {
        body = validateWithSchema(self._schema, body)
      } catch (e) {
        self.debug('response failed schema validation', self.uri.href)
        self.onRequestError(e)
        return
      }
    }

    self.debug('emitting complete', self.uri.href)

    if (typeof body === 'undefined' && !self._json) {
      body = self.encoding === null ? Buffer.alloc(0) : ''
    }
    Object.defineProperty(response, 'body', {
      value: body,
      enumerable: true,
      configurable: true,
      writable: true
    })
    self.emit('complete', response, body)
  } else {
    self.push(null)
    self.emit('complete', self.response)
  }
}

module.exports = { handleRequestResponse, handleResponseData, handleResponseEnd }
