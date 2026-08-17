'use strict'

const { makeResponse } = require('../core/fake')

const DEFAULT_CACHEABLE = new Set([200, 203, 204, 206, 300, 301, 308, 404, 405, 414, 501])
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
    this.maxBytes = options.maxBytes || 64 * 1024 * 1024
    this._entries = new Map()
    this._bytes = 0
  }

  lookup (self) {
    if (self.method !== 'GET') {
      return null
    }
    if (self.hasHeader('cookie') || self.hasHeader('authorization')) {
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

  applyRevalidation (self, result) {
    const entry = result.entry
    if (entry.validators.etag && !self.hasHeader('if-none-match')) {
      self.setHeader('if-none-match', entry.validators.etag)
    }
    if (entry.validators.lastModified && !self.hasHeader('if-modified-since')) {
      self.setHeader('if-modified-since', entry.validators.lastModified)
    }
  }

  serve (self, entry) {
    const response = makeResponse(self, {
      statusCode: entry.statusCode,
      headers: entry.headers,
      body: entry.body
    })
    response.fromCache = true
    return response
  }

  store (self, response, body) {
    if (self.method !== 'GET') {
      return
    }
    if (self.hasHeader('range')) {
      return
    }
    const statusCode = response.statusCode
    const cacheControl = parseCacheControl(response.headers['cache-control'])
    if (cacheControl['no-store'] || cacheControl.private === true) {
      return
    }
    if (!DEFAULT_CACHEABLE.has(statusCode) && cacheControl.public !== true) {
      return
    }
    if (self.hasHeader('cookie') && cacheControl.public !== true) {
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
    this._entries.delete(self.uri.href)
    this._entries.set(self.uri.href, variants.concat(entry))
    this._bytes += body.length
    this._evict()
  }

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
        if (name.toLowerCase() === 'content-length') {
          continue
        }
        entry.headers[name] = response.headers[name]
      }
      if (response.headers['cache-control'] !== undefined) {
        entry.cacheControl = parseCacheControl(response.headers['cache-control'])
      }
      const variants = this._entries.get(self.uri.href)
      this._entries.delete(self.uri.href)
      this._entries.set(self.uri.href, variants)
      return entry
    }
    return null
  }

  _evict () {
    while (this.size > this.maxEntries || this._bytes > this.maxBytes) {
      const first = this._entries.keys().next().value
      if (first === undefined) {
        return
      }
      const variants = this._entries.get(first)
      const removed = variants.shift()
      if (removed) {
        this._bytes -= removed.body.length
      }
      if (variants.length === 0) {
        this._entries.delete(first)
      }
    }
  }

  _isStale (entry) {
    const cc = entry.cacheControl
    let lifetime = null
    if (cc['max-age'] !== undefined && cc['max-age'] !== true) {
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
    this._bytes = 0
  }

  get size () {
    let total = 0
    for (const variants of this._entries.values()) {
      total += variants.length
    }
    return total
  }
}

const defaultCache = new HttpCache()

module.exports = { HttpCache, defaultCache }
