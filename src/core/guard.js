'use strict'

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

// Per-host guards: circuit breaker and rate limiting. Both key on
// `uri.host` (hostname + port, default ports elided by the URL parser) so
// services behind the same hostname but different ports get independent
// state instead of one circuit masking another's error profile.

const { makeAbortError } = require('../transport/errors')

// Upper bound for the state maps so a long-running process cannot leak
// state for hosts it will never touch again.
const MAX_STATES = 1000

const breakers = new Map()
const buckets = new Map()

function stateKey (self) {
  return self.uri.host
}

// Evict the oldest entry when a state map exceeds its cap. The circuit
// breaker's open state must survive churn: evicting it would silently let
// requests through a host that is mid-cooldown, bypassing the breaker.
// Pass `isOpen` to skip such entries (the oldest non-open entry is evicted
// instead); the rate-limit buckets have no comparable state and evict freely.
function evictIfNeeded (map, isOpen) {
  if (map.size <= MAX_STATES) {
    return
  }
  if (!isOpen) {
    map.delete(map.keys().next().value)
    return
  }
  // Find the oldest non-open entry; if every entry is open, evict the
  // oldest open one anyway so the map stays bounded (a host that opens its
  // circuit right after eviction simply re-arms on the next request).
  for (const key of map.keys()) {
    if (!isOpen(map.get(key))) {
      map.delete(key)
      return
    }
  }
  map.delete(map.keys().next().value)
}

// --- Circuit breaker -------------------------------------------------------

// circuitBreaker: true -> defaults, number -> threshold, or
// { threshold, cooldown }.
function normalizeCircuitBreaker (value) {
  if (!value) {
    return null
  }
  if (value === true) {
    return { threshold: 5, cooldown: 30000 }
  }
  if (typeof value === 'number') {
    return { threshold: value, cooldown: 30000 }
  }
  return {
    threshold: value.threshold === undefined ? 5 : value.threshold,
    cooldown: value.cooldown === undefined ? 30000 : value.cooldown
  }
}

// True when requests to this host must fail fast. The first request after
// the cooldown is let through as a half-open probe; every other request is
// blocked while the probe is in flight.
function cbOpen (self) {
  const state = breakers.get(stateKey(self))
  if (!state || !state.openedAt) {
    return false
  }
  if (state.probing || Date.now() - state.openedAt < self._circuitBreaker.cooldown) {
    return true
  }
  state.probing = true
  return false
}

function cbRecordFailure (self) {
  const state = cbState(self)
  if (state.probing) {
    // The half-open probe failed: re-open for another full cooldown.
    state.probing = false
    state.openedAt = Date.now()
    return
  }
  state.failures++
  if (state.failures >= self._circuitBreaker.threshold) {
    state.failures = 0
    state.openedAt = Date.now()
  }
}

function cbRecordSuccess (self) {
  const state = breakers.get(stateKey(self))
  if (!state) {
    return
  }
  if (state.probing) {
    // The probe succeeded: close the circuit.
    state.probing = false
    state.openedAt = 0
  }
  state.failures = 0
}

function cbState (self) {
  const key = stateKey(self)
  let state = breakers.get(key)
  if (!state) {
    state = { failures: 0, openedAt: 0, probing: false }
    breakers.set(key, state)
    evictIfNeeded(breakers, function (candidate) {
      // Never evict a circuit that is open (or mid half-open probe):
      // its cooldown must keep blocking requests.
      return candidate.openedAt !== 0 || candidate.probing
    })
  }
  return state
}

// --- Rate limiting ---------------------------------------------------------

// rateLimit: true -> defaults, number -> req/sec, or { rate, capacity }.
// A token bucket per host: `capacity` tokens may be spent at once (burst),
// then tokens refill at `rate` per second. Waiters re-check the bucket
// after each refill so concurrent callers cannot over-issue.
function normalizeRateLimit (value) {
  if (!value) {
    return null
  }
  if (value === true) {
    return { rate: 10, capacity: 10 }
  }
  if (typeof value === 'number') {
    return { rate: value, capacity: value }
  }
  return {
    rate: value.rate === undefined ? 10 : value.rate,
    capacity: value.capacity === undefined ? (value.rate === undefined ? 10 : value.rate) : value.capacity
  }
}

// Resolves once a token is available (immediately while the burst allows
// it). Rejects with an abort error when the request is aborted while
// waiting.
function rateAcquire (self) {
  const cfg = self._rateLimit
  const key = stateKey(self)
  let bucket = buckets.get(key)
  const now = Date.now()
  if (!bucket) {
    bucket = { tokens: cfg.capacity, last: now }
    buckets.set(key, bucket)
    evictIfNeeded(buckets)
  } else {
    bucket.tokens = Math.min(cfg.capacity, bucket.tokens + ((now - bucket.last) / 1000) * cfg.rate)
    bucket.last = now
  }
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1
    return Promise.resolve()
  }

  const signal = self._controller.signal
  return new Promise(function (resolve, reject) {
    if (signal.aborted) {
      return reject(makeAbortError())
    }
    let timer
    const onAbort = function () {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(makeAbortError())
    }
    const step = function () {
      if (signal.aborted) {
        signal.removeEventListener('abort', onAbort)
        return reject(makeAbortError())
      }
      const now = Date.now()
      bucket.tokens = Math.min(cfg.capacity, bucket.tokens + ((now - bucket.last) / 1000) * cfg.rate)
      bucket.last = now
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1
        signal.removeEventListener('abort', onAbort)
        return resolve()
      }
      timer = setTimeout(step, Math.max(1, Math.ceil(((1 - bucket.tokens) / cfg.rate) * 1000)))
    }
    timer = setTimeout(step, Math.max(1, Math.ceil(((1 - bucket.tokens) / cfg.rate) * 1000)))
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

module.exports = { normalizeCircuitBreaker, normalizeRateLimit, cbOpen, cbRecordFailure, cbRecordSuccess, rateAcquire }
