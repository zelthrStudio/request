'use strict'

// Modified by zelthrStudio (2026) from the original `request` package
// (Copyright 2010-2012 Mikeal Rogers, Apache License 2.0).

// Minimal RFC 6265 cookie jar with no external dependencies. Supports
// parsing Set-Cookie strings, domain/path matching, expiration (Max-Age /
// Expires) and Secure/HttpOnly flags, plus a sync API matching what request
// needs (setCookie/getCookieString/getCookies).

function defaultPath (pathname) {
  if (!pathname || pathname === '/') {
    return '/'
  }
  const index = pathname.lastIndexOf('/')
  return index === 0 ? '/' : pathname.slice(0, index)
}

function pathMatches (requestPath, cookiePath) {
  if (requestPath === cookiePath) {
    return true
  }
  if (cookiePath.slice(-1) === '/') {
    return requestPath.startsWith(cookiePath)
  }
  return requestPath.startsWith(cookiePath + '/')
}

function Cookie (key, value) {
  this.key = key
  this.value = value
  this.path = '/'
  this.domain = null
  this.expires = null
  this.maxAge = null
  this.secure = false
  this.httpOnly = false
}

Object.defineProperty(Cookie.prototype, 'name', {
  get: function () {
    return this.key
  },
  enumerable: true,
  configurable: true
})

Cookie.prototype.toString = function () {
  return this.key + '=' + this.value
}

// Parse a Set-Cookie string ('name=value; Path=/; HttpOnly').
function parse (str) {
  if (typeof str !== 'string' || str.length === 0) {
    return null
  }
  const parts = str.split(';')
  const first = parts[0]
  const eqIndex = first.indexOf('=')
  let key
  let value
  if (eqIndex === -1) {
    key = first.trim()
    value = ''
  } else {
    key = first.slice(0, eqIndex).trim()
    value = first.slice(eqIndex + 1).trim()
  }
  if (!key) {
    return null
  }

  const cookie = new Cookie(key, value)
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].trim()
    const idx = part.indexOf('=')
    const attr = (idx === -1 ? part : part.slice(0, idx)).trim().toLowerCase()
    const val = idx === -1 ? '' : part.slice(idx + 1).trim()
    switch (attr) {
      case 'path':
        cookie.path = val || '/'
        break
      case 'domain':
        cookie.domain = val.replace(/^\./, '').toLowerCase()
        break
      case 'expires': {
        const time = Date.parse(val)
        if (!isNaN(time)) {
          cookie.expires = new Date(time)
        }
        break
      }
      case 'max-age':
        cookie.maxAge = Number(val)
        break
      case 'secure':
        cookie.secure = true
        break
      case 'httponly':
        cookie.httpOnly = true
        break
    }
  }
  return cookie
}

// A memory-backed jar with the sync API of a tough-cookie CookieJar.
class CookieJar {
  constructor () {
    this._cookies = []
  }

  setCookieSync (cookieOrStr, url) {
    const cookie = typeof cookieOrStr === 'string' ? parse(cookieOrStr) : cookieOrStr
    if (!cookie) {
      return
    }
    let uri
    try {
      uri = new URL(url)
    } catch (e) {
      return
    }
    if (!cookie.domain) {
      cookie.domain = uri.hostname.toLowerCase()
      cookie.hostOnly = true
    } else {
      // RFC 6265 §5.3: a server may only set a Domain attribute that
      // domain-matches the request host, otherwise any server could plant
      // cookies for unrelated hosts into the (shared/global) jar. Without a
      // public-suffix list, single-label domains ("com", "net", ...) are
      // also rejected unless they are the request host itself, closing the
      // `Domain=com`-style poisoning variant.
      const host = uri.hostname.toLowerCase()
      const domain = cookie.domain.toLowerCase()
      const domainMatches = host === domain || host.endsWith('.' + domain)
      if (!domainMatches || (domain.indexOf('.') === -1 && host !== domain)) {
        return
      }
    }
    if (!cookie.path) {
      cookie.path = defaultPath(uri.pathname)
    }
    if (cookie.maxAge !== null && !isNaN(cookie.maxAge)) {
      cookie.expires = new Date(Date.now() + cookie.maxAge * 1000)
    }
    // A cookie with a past expiry is deleted, not stored.
    if (cookie.expires && cookie.expires.getTime() < Date.now()) {
      this._cookies = this._cookies.filter(function (c) {
        return !(c.key === cookie.key && c.domain === cookie.domain && c.path === cookie.path)
      })
      return
    }
    // Replace any existing cookie with the same key/domain/path.
    this._cookies = this._cookies.filter(function (c) {
      return !(c.key === cookie.key && c.domain === cookie.domain && c.path === cookie.path)
    })
    this._cookies.push(cookie)
  }

  getCookiesSync (url) {
    let uri
    try {
      uri = new URL(url)
    } catch (e) {
      return []
    }
    const host = uri.hostname.toLowerCase()
    const path = uri.pathname || '/'
    const secure = uri.protocol === 'https:'
    const now = Date.now()
    return this._cookies.filter(function (cookie) {
      if (cookie.expires && cookie.expires.getTime() < now) {
        return false
      }
      if (cookie.secure && !secure) {
        return false
      }
      const domain = cookie.domain
      if (cookie.hostOnly) {
        if (host !== domain) {
          return false
        }
      } else if (host !== domain && !host.endsWith('.' + domain)) {
        return false
      }
      return pathMatches(path, cookie.path)
    }).sort(function (a, b) {
      return b.path.length - a.path.length
    })
  }

  getCookieStringSync (url) {
    return this.getCookiesSync(url).map(function (cookie) {
      return cookie.toString()
    }).join('; ')
  }
}

// Adapt the (sync) jar API used by request. A tough-cookie store argument is
// accepted for compatibility but ignored; storage is always in memory.
function RequestJar (store) {
  this._jar = new CookieJar()
  this._store = store
}

RequestJar.prototype.setCookie = function (cookieOrStr, uri, options) {
  return this._jar.setCookieSync(cookieOrStr, uri)
}

RequestJar.prototype.getCookieString = function (uri) {
  return this._jar.getCookieStringSync(uri)
}

RequestJar.prototype.getCookies = function (uri) {
  return this._jar.getCookiesSync(uri)
}

exports.parse = parse
exports.Cookie = Cookie
exports.CookieJar = CookieJar

exports.jar = function (store) {
  return new RequestJar(store)
}

// Global jar used to persist cookies across requests unless a jar is passed.
exports.globalJar = new RequestJar()
