'use strict'

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

// In-flight request coalescing: concurrent GET/HEAD requests to the same
// URL are merged onto a single network request and the buffered response
// is replayed to every waiter. Opt-in per request via `dedupe: true` and
// only applied to idempotent GET/HEAD; the primary response is buffered
// (collect mode) so each waiter receives its own copy, which also means
// `timeout` on a deduped request is governed by the primary's timer.

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

const inFlight = new Map()

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
  const key = method + ' ' + self.uri.href
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

module.exports = { acquire }
