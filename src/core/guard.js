'use strict'

const { makeAbortError } = require('../transport/errors')

const MAX_TIMEOUT_MS = 2147483647

function clampDelay (delayMs) {
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    return 1
  }
  return Math.min(delayMs, MAX_TIMEOUT_MS)
}

const MAX_STATES = 1000

const breakers = new Map()
const buckets = new Map()

function stateKey (self) {
  return self.uri.host
}

function evictIfNeeded (map, isOpen) {
  if (map.size <= MAX_STATES) {
    return
  }
  if (!isOpen) {
    map.delete(map.keys().next().value)
    return
  }
  for (const key of map.keys()) {
    if (!isOpen(map.get(key))) {
      map.delete(key)
      return
    }
  }
  map.delete(map.keys().next().value)
}

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
      return candidate.openedAt !== 0 || candidate.probing
    })
  }
  return state
}

function normalizeRateLimit (value) {
  if (!value) {
    return null
  }
  if (value === true) {
    return { rate: 10, capacity: 10 }
  }
  if (typeof value === 'number') {
    if (!(value > 0) || !Number.isFinite(value)) {
      return null
    }
    return { rate: value, capacity: value }
  }
  const rate = value.rate === undefined ? 10 : value.rate
  const capacity = value.capacity === undefined ? (value.rate === undefined ? 10 : value.rate) : value.capacity
  if (typeof rate !== 'number' || !(rate > 0) || !Number.isFinite(rate)) {
    throw new Error('options.rateLimit.rate must be a positive finite number')
  }
  if (typeof capacity !== 'number' || !(capacity >= 1) || !Number.isFinite(capacity)) {
    throw new Error('options.rateLimit.capacity must be a finite number of at least 1')
  }
  return { rate, capacity }
}

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
      timer = setTimeout(step, clampDelay(Math.ceil(((1 - bucket.tokens) / cfg.rate) * 1000)))
    }
    timer = setTimeout(step, clampDelay(Math.ceil(((1 - bucket.tokens) / cfg.rate) * 1000)))
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

module.exports = { normalizeCircuitBreaker, normalizeRateLimit, cbOpen, cbRecordFailure, cbRecordSuccess, rateAcquire }
