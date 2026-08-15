'use strict'

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

// In-flight request coalescing: concurrent GET/HEAD requests to the same
// URL are merged onto a single network request and the buffered response
// is replayed to every waiter. Opt-in per request via `dedupe: true` and
// only applied to idempotent GET/HEAD; the primary response is buffered
// (collect mode) so each waiter receives its own copy, which also means
// `timeout` on a deduped request is governed by the primary's timer.

const crypto = require('crypto')

const { makeResponse } = require('./fake')

// Wire-level headers describing the primary's transport representation;
// the replayed body is already decoded and buffered, so these would be
// misleading on a synthetic response.
const STRIP_HEADERS = new Set([
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive'
])

// Headers that change the meaning of a response: two concurrent requests to
// the same URL with different credentials must not share one network
// request, or the primary's response (session data, per-request nonces)
// would leak to the other caller.
const CREDENTIAL_HEADERS = ['authorization', 'cookie']

const inFlight = new Map()

// Upper bound on the coalescing table. A primary that hangs (or a workload
// that touches many URLs) must not pin entries forever; when the map
// overflows, the oldest entry is dropped so a later request for that URL
// simply starts its own primary. The evicted primary still delivers to the
// waiters already attached to it.
const MAX_IN_FLIGHT = 1000

// The coalescing key: method + URL, plus the credential headers when
// present. Hashing keeps tokens out of the key string.
function dedupeKey (self) {
  let key = self.method + ' ' + self.uri.href
  const parts = []
  for (const name of Object.keys(self.headers)) {
    if (CREDENTIAL_HEADERS.indexOf(name.toLowerCase()) !== -1) {
      parts.push(name.toLowerCase() + '=' + String(self.headers[name]))
    }
  }
  if (parts.length > 0) {
    key += '&h=' + crypto.createHash('sha256').update(parts.sort().join('&')).digest('hex')
  }
  return key
}

// Returns true when the request attached to an existing in-flight request
// (the primary will deliver the result), false when it should proceed as
// the primary itself.
function acquire (self) {
  if (!self._dedupe) {
    return false
  }
  const method = (self.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    return false
  }
  const key = dedupeKey(self)
  const existing = inFlight.get(key)
  if (existing) {
    if (self._aborted) {
      return false
    }
    existing.waiters.push(self)
    self.once('abort', function () {
      const index = existing.waiters.indexOf(self)
      if (index !== -1) {
        existing.waiters.splice(index, 1)
      }
    })
    return true
  }

  // Become the primary. The body must be buffered so every waiter can be
  // served a copy once the response completes.
  self._collect = true
  self._chunks = self._chunks || []
  const entry = { primary: self, waiters: [] }
  inFlight.set(key, entry)
  if (inFlight.size > MAX_IN_FLIGHT) {
    inFlight.delete(inFlight.keys().next().value)
  }
  self.once('complete', function () {
    if (inFlight.get(key) === entry) {
      inFlight.delete(key)
    }
    deliver(entry)
  })
  self.once('error', function (err) {
    if (inFlight.get(key) === entry) {
      inFlight.delete(key)
    }
    fail(entry, err)
  })
  self.once('abort', function () {
    if (inFlight.get(key) === entry) {
      inFlight.delete(key)
    }
    fail(entry, new Error('Request aborted'))
  })
  return false
}

// Replay the primary's collected response to every waiting request.
function deliver (entry) {
  const primary = entry.primary
  const headers = {}
  for (const name of Object.keys(primary.response.headers)) {
    if (!STRIP_HEADERS.has(name.toLowerCase())) {
      headers[name] = primary.response.headers[name]
    }
  }
  const body = Buffer.concat(primary._chunks)
  for (const waiter of entry.waiters) {
    if (waiter._aborted) {
      continue
    }
    const response = makeResponse(waiter, {
      statusCode: primary.response.statusCode,
      headers,
      body
    })
    response.fromDedupe = true
    waiter.onRequestResponse(response).catch(function () {})
  }
}

function fail (entry, err) {
  for (const waiter of entry.waiters) {
    if (!waiter._aborted) {
      waiter.onRequestError(err)
    }
  }
}

// The map is exported for tests (this module is internal, not part of the
// public API) so the bounded-size behavior can be verified directly.
module.exports = { acquire, inFlight }
