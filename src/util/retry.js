'use strict'

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

// Built-in retry support, modeled after Got. Opt-in via `retry: true` or a
// configuration object; never retried unless the request body is replayable.
// Only safe (idempotent) methods are retried by default: PUT/DELETE can
// duplicate side effects if the first attempt reached the server but the
// response was lost. Callers that own the idempotency (e.g. an explicit
// idempotency key on the endpoint) can opt back in via `methods`.
const retryDefaults = {
  limit: 3,
  methods: ['GET', 'HEAD', 'OPTIONS'],
  statusCodes: [429, 503],
  errorCodes: ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'EPIPE'],
  maxRetryAfter: 30000,
  backoff: 1000,
  jitter: false
}

function normalizeRetry (value) {
  if (!value) {
    return null
  }
  const config = Object.assign({}, retryDefaults)
  if (value === true) {
    return config
  }
  if (typeof value === 'number') {
    config.limit = value
    return config
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      config[key] = value[key]
    }
    return config
  }
  return null
}

function canRetry (self) {
  if (!self._retry || self._aborted) {
    return false
  }
  if (self._retryAttempts >= self._retry.limit) {
    return false
  }
  if (self._retry.methods && self._retry.methods.indexOf(self.method) === -1) {
    return false
  }
  return self._bodyReplayable !== false
}

function shouldRetryError (self, error) {
  if (!canRetry(self)) {
    return false
  }
  if (self._retry.errorCodes && self._retry.errorCodes.indexOf(error.code) === -1) {
    return false
  }
  return true
}

function shouldRetryStatus (self, statusCode) {
  if (!canRetry(self)) {
    return false
  }
  if (self._retry.statusCodes && self._retry.statusCodes.indexOf(statusCode) === -1) {
    return false
  }
  return true
}

// Delay before the next attempt. Honors the Retry-After header (capped by
// maxRetryAfter), falling back to an exponential backoff.
function retryDelay (self, error, response) {
  const retry = self._retry
  let delay

  if (response && response.headers && response.headers['retry-after'] !== undefined) {
    const ra = String(response.headers['retry-after'])
    let seconds
    if (/^\d+$/.test(ra)) {
      seconds = Number(ra)
    } else {
      const time = Date.parse(ra)
      if (!isNaN(time)) {
        seconds = Math.max(0, (time - Date.now()) / 1000)
      }
    }
    if (seconds !== undefined) {
      delay = seconds * 1000
      if (retry.maxRetryAfter !== undefined) {
        delay = Math.min(delay, retry.maxRetryAfter)
      }
    }
  }

  if (delay === undefined) {
    if (typeof retry.backoff === 'function') {
      delay = retry.backoff(self._retryAttempts, error, response)
    } else {
      delay = retry.backoff * Math.pow(2, self._retryAttempts - 1)
    }
  }

  if (retry.jitter) {
    const amount = typeof retry.jitter === 'number' ? retry.jitter : delay * 0.25
    delay += Math.random() * amount
  }

  return delay
}

module.exports = { normalizeRetry, shouldRetryError, shouldRetryStatus, retryDelay }
