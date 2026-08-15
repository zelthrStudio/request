'use strict'

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

// RFC 7234 HTTP cache: an in-process, in-memory store for GET responses.
// Fresh entries are served without touching the network; stale entries are
// revalidated with If-None-Match / If-Modified-Since and refreshed when the
// server answers 304 Not Modified. The Vary response header is honored by
// keying entries on the request header values the response declared.

const { makeResponse } = require('../core/fake')

// Status codes cacheable by default (RFC 7234 section 4.2.2).
const DEFAULT_CACHEABLE = new Set([200, 203, 204, 206, 300, 301, 308, 404, 405, 414, 501])

// Response headers that must not be replayed verbatim when serving a stored
// body: the body we store is already decoded, and hop-by-hop headers do not
// make sense across a cache boundary.
const STRIPPED_HEADERS = ['content-encoding', 'transfer-encoding', 'connection', 'keep-alive', 'set-cookie']

function parseCacheControl (value) {
  const directives = {}
  if (!value) {
    return directives
  }
  for (const part of String(value).split(',')) {
    const pair = part.trim().split('=', 2)
    const name = pair[0].toLowerCase()
    directives[name] = pair.length > 1 ? pair[1].trim() : true
  }
  return directives
}

function parseDate (value) {
  if (!value) {
    return NaN
  }
  const time = Date.parse(value)
  return Number.isNaN(time) ? NaN : time
}

function varyKey (self, varyHeader) {
  if (!varyHeader) {
    return ''
  }
  const names = String(varyHeader).split(',').map(function (name) {
    return name.trim().toLowerCase()
  }).filter(Boolean)
  if (names.indexOf('*') !== -1) {
    return '*'
  }
  return names.map(function (name) {
    return name + '=' + (self.getHeader(name) || '')
  }).join('&')
}

class HttpCache {
  constructor (options) {
    options = options || {}
    this.ttl = options.ttl || 60000
    this.maxEntries = options.maxEntries || 200
    this._entries = new Map()
  }

  // Look up a stored entry for this request. Returns null on a miss, or
  // { entry, fresh: true } to serve directly, or { entry, fresh: false,
  // revalidate: true } when the entry is stale (or must be revalidated).
  // Entries are grouped per URL, with one variant per Vary key.
  lookup (self) {
    if (self.method !== 'GET') {
      return null
    }
    const variants = this._entries.get(self.uri.href)
    if (!variants) {
      return null
    }
    for (const entry of variants) {
      if (entry.varyKey !== varyKey(self, entry.vary)) {
        continue
      }
      if (entry.cacheControl['no-cache'] || this._isStale(entry)) {
        return { entry, fresh: false, revalidate: true }
      }
      return { entry, fresh: true }
    }
    return null
  }

  // Add conditional headers so the next attempt revalidates the entry.
  applyRevalidation (self, result) {
    const entry = result.entry
    if (entry.validators.etag && !self.hasHeader('if-none-match')) {
      self.setHeader('if-none-match', entry.validators.etag)
    }
    if (entry.validators.lastModified && !self.hasHeader('if-modified-since')) {
      self.setHeader('if-modified-since', entry.validators.lastModified)
    }
  }

  // Build a response stream from a stored entry.
  serve (self, entry) {
    const response = makeResponse(self, {
      statusCode: entry.statusCode,
      headers: entry.headers,
      body: entry.body
    })
    response.fromCache = true
    return response
  }

  // Store a completed GET response. Returns nothing; silently skips
  // responses that must not be cached.
  store (self, response, body) {
    if (self.method !== 'GET') {
      return
    }
    const statusCode = response.statusCode
    const cacheControl = parseCacheControl(response.headers['cache-control'])
    if (cacheControl['no-store']) {
      return
    }
    if (!DEFAULT_CACHEABLE.has(statusCode) && cacheControl.public !== true) {
      return
    }
    if (self.hasHeader('authorization') && cacheControl.public !== true) {
      return
    }
    const vary = response.headers.vary
    if (vary === '*') {
      return
    }
    const headers = {}
    for (const name of Object.keys(response.headers)) {
      if (STRIPPED_HEADERS.indexOf(name.toLowerCase()) !== -1) {
        continue
      }
      headers[name] = response.headers[name]
    }
    headers['content-length'] = body.length

    const entry = {
      url: self.uri.href,
      statusCode,
      headers,
      body,
      storedAt: Date.now(),
      vary,
      varyKey: varyKey(self, vary),
      cacheControl,
      validators: {
        etag: response.headers.etag || null,
        lastModified: response.headers['last-modified'] || null
      }
    }
    const variants = this._entries.get(self.uri.href) || []
    this._entries.set(self.uri.href, variants.concat(entry))
    this._evict()
  }

  // A 304 revalidation response refreshes the stored entry. Returns the
  // refreshed entry, or null when there is nothing stored to refresh.
  refresh (self, response) {
    const variants = this._entries.get(self.uri.href)
    if (!variants) {
      return null
    }
    for (const entry of variants) {
      if (entry.varyKey !== varyKey(self, entry.vary)) {
        continue
      }
      entry.storedAt = Date.now()
      for (const name of Object.keys(response.headers)) {
        if (STRIPPED_HEADERS.indexOf(name.toLowerCase()) !== -1) {
          continue
        }
        // A 304 response carries its own content-length (usually 0); the
        // stored entry's body length is authoritative and must win.
        if (name.toLowerCase() === 'content-length') {
          continue
        }
        entry.headers[name] = response.headers[name]
      }
      return entry
    }
    return null
  }

  // Keep the store under maxEntries by evicting from the oldest URL.
  _evict () {
    while (this.size > this.maxEntries) {
      const first = this._entries.keys().next().value
      if (first === undefined) {
        return
      }
      const variants = this._entries.get(first)
      variants.shift()
      if (variants.length === 0) {
        this._entries.delete(first)
      }
    }
  }

  _isStale (entry) {
    const cc = entry.cacheControl
    let lifetime = null
    if (cc['max-age'] !== undefined && cc['max-age'] !== true) {
      // A malformed max-age (e.g. "abc") must not produce NaN, which would
      // make every entry "stale" forever; fall back to the heuristics.
      const seconds = Number(cc['max-age'])
      if (Number.isFinite(seconds) && seconds >= 0) {
        lifetime = seconds * 1000
      }
    } else {
      const date = parseDate(entry.headers.date)
      const expires = parseDate(entry.headers.expires)
      if (!Number.isNaN(expires) && !Number.isNaN(date) && expires - date >= 0) {
        lifetime = expires - date
      } else if (entry.headers['last-modified']) {
        const lastModified = parseDate(entry.headers['last-modified'])
        if (!Number.isNaN(lastModified) && !Number.isNaN(date)) {
          // Heuristic freshness (RFC 7234 section 4.2.2): 10% of the time
          // between last modification and the response date.
          lifetime = Math.floor((date - lastModified) * 0.1)
        }
      }
    }
    if (lifetime === null) {
      lifetime = this.ttl
    }
    return (Date.now() - entry.storedAt) >= lifetime
  }

  clear () {
    this._entries.clear()
  }

  get size () {
    let total = 0
    for (const variants of this._entries.values()) {
      total += variants.length
    }
    return total
  }
}

// Shared instance used by `cache: true`, exposed as request.cache.
const defaultCache = new HttpCache()

module.exports = { HttpCache, defaultCache }
