'use strict'

// Modified by zelthrStudio (2026) from the original `request` package
// (Copyright 2010-2012 Mikeal Rogers, Apache License 2.0).

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

// Size cap for bodies buffered in memory (callback/promise mode) when the
// caller did not set an explicit `maxBytes`. Streamed responses are
// unaffected unless the caller opts into a limit.
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024

// Adapt the native response stream (http.IncomingMessage or an http2 stream)
// into the response object, carrying status code, headers and request
// metadata.
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

  // A response arrived for this host: the circuit breaker (if any) can
  // start counting failures from a clean slate.
  if (self._circuitBreaker) {
    guard.cbRecordSuccess(self)
  }

  // Accumulate decoded bytes for the RFC 7234 cache (only for fresh GETs).
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

  // Save set-cookie headers into the cookie jar.
  const targetCookieJar = (self._jar && self._jar.setCookie) ? self._jar : cookies.globalJar
  const addCookie = function (cookie) {
    try {
      targetCookieJar.setCookie(cookie, self.uri.href, { ignoreError: true })
    } catch (e) {
      self.emit('error', e)
    }
  }

  // Collect the raw Set-Cookie headers. http/1.x responses carry them in
  // rawHeaders (one entry per header line); http/2 and undici join multiple
  // Set-Cookie lines into one string, which must be split back apart.
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
      // Fallback: split on ', ' only when the fragment starts with a cookie
      // name followed by '='. A naive split(', ') would tear the "Wdy, DD
      // Mon YYYY" date inside an Expires attribute into a bogus cookie.
      return String(value).split(/,\s*(?=[A-Za-z0-9!#$%&'*+\-.^_`|~]+\s*=)/).filter(Boolean)
    }
    splitSetCookies(response.headers[setCookieName]).forEach(addCookie)
  }

  if (self._redirect.onResponse(response)) {
    return // Ignore the rest of the response.
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

  // A 304 Not Modified revalidates the stored entry: refresh it and serve
  // the cached body in place of the empty 304.
  if (self._cache && self.method === 'GET' && response.statusCode === 304) {
    const entry = self._cache.refresh(self, response)
    if (entry) {
      response.on('error', function () {})
      response.destroy()
      response = self._cache.serve(self, entry)
      response.revalidated = true
      self.response = response
      // The served body must not be re-stored as a fresh entry (it would
      // duplicate the refreshed variant on every revalidation).
      self._cacheChunks = null
      if (self._progress && self._progress.total === null) {
        const len = response.headers['content-length']
        if (len !== undefined) {
          self._progress.total = Number(len)
        }
      }
    }
  }

  // afterResponse hooks may inspect (or replace) the response. Redirects
  // never reach this point, matching Got semantics.
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
      // Informational
      (code >= 100 && code < 200) ||
      // No Content
      code === 204 ||
      // Not Modified
      code === 304
    )
  }

  let responseContent = response
  if (self.gzip && !noBody(response.statusCode)) {
    const contentEncoding = (response.headers['content-encoding'] || 'identity').trim().toLowerCase()

    // Be more lenient with decoding compressed responses, since (very rarely)
    // servers send slightly invalid gzip responses that are still accepted
    // by common browsers. Always using Z_SYNC_FLUSH is what cURL does.
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
      // Since previous versions didn't check for Content-Encoding header,
      // ignore any invalid values to preserve backwards-compatibility.
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

// A hook returned a replacement response: adopt its statusCode/headers/body.
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
    self._cacheChunks.push(chunk)
  }
  if (self._collect) {
    const next = (self._collectedBytes || 0) + chunk.length
    // Every body that is buffered in memory (callback/promise mode) gets a
    // size budget: an explicit `maxBytes` option, or a generous default, so
    // a malicious or runaway server cannot exhaust memory.
    const limit = self.maxBytes !== undefined ? self.maxBytes : DEFAULT_MAX_BYTES
    if (next > limit) {
      // Abort once the response exceeds the caller's size budget. The
      // destroyed stream is given a no-op error listener so the single
      // error we emit below is the only one consumers see.
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
  // Push into the readable side only if someone is consuming this stream,
  // otherwise the data would be buffered forever. The Readable machinery
  // emits the 'data' events itself for flowing consumers.
  if (self._readableState.flowing || self._readableState.pipes) {
    const ok = self.push(chunk)
    if (!ok && self.responseContent && self.responseContent.isPaused()) {
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
      const buf = Buffer.concat(self._chunks)
      body = self.encoding === null ? buf : buf.toString(self.encoding || 'utf8')
      // The UTF8 BOM [0xEF,0xBB,0xBF] is converted to [0xFE,0xFF] in the JS
      // UTC16/UCS2 representation. Strip this value out when the encoding is
      // set to a UTF-8 alias ('utf8' or 'utf-8'), as upstream consumers
      // won't expect it and it breaks JSON.parse().
      const isUtf8 = self.encoding === 'utf8' || self.encoding === 'utf-8'
      if (isUtf8 && typeof body === 'string' && body.charCodeAt(0) === 0xFEFF) {
        body = body.slice(1)
      }
    }

    if (self._json) {
      // `json: true` promises a parsed object; a non-JSON payload must not
      // silently degrade into a raw string that callers will misread as a
      // successful parse.
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

    // Schema validation: zod throws, joi/valibot-style validators fail
    // with a result object; a plain function may throw or transform.
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
