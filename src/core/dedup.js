'use strict'

const crypto = require('crypto')

const { makeResponse } = require('./fake')

const STRIP_HEADERS = new Set([
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive'
])

const CREDENTIAL_HEADERS = ['authorization', 'cookie']

const inFlight = new Map()

const MAX_IN_FLIGHT = 1000

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
    if (existing.primary === self) {
      if (inFlight.get(key) === existing) {
        inFlight.delete(key)
      }
      return false
    }
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

module.exports = { acquire, inFlight }
