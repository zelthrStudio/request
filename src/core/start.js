'use strict'

// Modified by zelthrStudio (2026) from the original `request` package
// (Copyright 2010-2012 Mikeal Rogers, Apache License 2.0).

const stream = require('stream')

const { initTimings } = require('../util').timing
const { closeDisposableAgent } = require('../transport')
const transport = require('../transport')
const { shouldRetryError, retryDelay } = require('../util').retry
const { makeResponse } = require('./fake')
const mockResolve = require('../mock').resolve

// start() is called once we are ready to send the outgoing HTTP request.
// This is usually called on the first write(), end() or on nextTick().
function startRequest (self) {
  if (self._aborted || self._started) {
    return
  }
  self._started = true
  self.method = self.method || 'GET'
  self.href = self.uri.href

  if (self.src && self.src.stat && self.src.stat.size && !self.hasHeader('content-length')) {
    self.setHeader('content-length', self.src.stat.size)
  }

  if (self.timing) {
    initTimings(self)
  }

  self.debug('make request', self.uri.href)

  self._bodyStream = self._bodyStream || new stream.PassThrough()
  self._bodyStream.on('drain', function () {
    self.emit('drain')
  })
  self._bodyStream.on('error', function (err) {
    if (!self._aborted) {
      self.emit('error', err)
    }
  })
  if (self._progress && self._progress.uploadedTotal === null && self.hasHeader('content-length')) {
    self._progress.uploadedTotal = Number(self.getHeader('content-length'))
  }

  self.req = self.req || {
    destroy: function () {
      self.abort()
    },
    abort: function () {
      self.abort()
    }
  }

  runAttempt(self)
}

// One dispatch attempt. Retries (network errors) and status-based retries
// (429/503) schedule a new attempt via runAttempt().
async function runAttempt (self) {
  if (self._aborted) {
    return
  }

  let result
  try {
    const hooks = self._hooks && self._hooks.beforeRequest
    if (hooks && hooks.length) {
      for (const hook of hooks) {
        await hook(self)
        if (self._aborted) {
          return
        }
      }
    }
    self.emit('request', self.req)

    // Mocking layer: a matching mock replaces the network response entirely.
    const mocked = await mockResolve(self)
    if (mocked) {
      const response = makeResponse(self, mocked)
      response.isMock = true
      self.onRequestResponse(response)
      return
    }

    // RFC 7234 cache: serve fresh entries directly, revalidate stale ones
    // with conditional headers on the outgoing request.
    if (self._cache) {
      const cached = self._cache.lookup(self)
      if (cached) {
        if (cached.fresh) {
          self._cacheHit = true
          self.onRequestResponse(self._cache.serve(self, cached.entry))
          return
        }
        self._cache.applyRevalidation(self, cached)
      }
    }

    result = await transport.dispatch(self)
  } catch (err) {
    if (self._aborted) {
      return
    }
    const error = transport.mapTimeoutError(err)
    if (shouldRetryError(self, error)) {
      self._retryAttempts++
      const delay = retryDelay(self, error, null)
      self.debug('retrying', self.uri.href, error.code || error.message, 'in', delay, 'ms')
      return setTimeout(function () {
        runAttempt(self)
      }, delay)
    }
    return self.onRequestError(error)
  }

  self.onRequestResponse(result)
}

function sendRequest (self) {
  if (!self._started) {
    self.start()
  }
}

function handleRequestError (self, error) {
  if (self._aborted) {
    return
  }
  self.clearTimeout()
  closeDisposableAgent(self, true)
  self.emit('error', error)
}

module.exports = { startRequest, sendRequest, handleRequestError, runAttempt }
