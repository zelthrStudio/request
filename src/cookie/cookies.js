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

// Common two-label public suffixes (ICANN PSL samples). `Domain=co.uk` must
// not be accepted from `evil.co.uk`; the registrable part of such a domain
// is a single label.
const TWO_PART_PUBLIC_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'net.uk', 'gov.uk', 'ac.uk', 'me.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'net.nz', 'org.nz', 'ac.nz', 'govt.nz',
  'co.jp', 'ne.jp', 'or.jp', 'go.jp', 'ac.jp', 'ad.jp', 'ed.jp',
  'co.kr', 'or.kr', 're.kr', 'ne.kr', 'go.kr', 'pe.kr',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'com.tw', 'org.tw', 'net.tw', 'edu.tw', 'gov.tw', 'idv.tw',
  'com.hk', 'org.hk', 'net.hk', 'edu.hk', 'gov.hk', 'idv.hk',
  'com.sg', 'org.sg', 'net.sg', 'edu.sg', 'gov.sg',
  'com.my', 'net.my', 'org.my', 'gov.my', 'edu.my',
  'com.ph', 'org.ph', 'net.ph', 'gov.ph', 'edu.ph',
  'com.vn', 'net.vn', 'org.vn', 'gov.vn', 'edu.vn',
  'co.th', 'or.th', 'ac.th', 'go.th', 'in.th', 'net.th',
  'co.id', 'or.id', 'web.id', 'ac.id', 'sch.id', 'go.id',
  'co.in', 'net.in', 'org.in', 'ac.in', 'gov.in', 'edu.in',
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
  'com.mx', 'org.mx', 'net.mx', 'gob.mx', 'edu.mx',
  'co.za', 'org.za', 'net.za', 'gov.za', 'ac.za',
  'com.tr', 'org.tr', 'net.tr', 'gov.tr', 'edu.tr',
  'com.sa', 'org.sa', 'net.sa', 'gov.sa', 'edu.sa',
  'com.eg', 'org.eg', 'net.eg', 'gov.eg', 'edu.eg',
  'com.ae', 'org.ae', 'net.ae', 'gov.ae', 'edu.ae',
  'com.pk', 'org.pk', 'net.pk', 'gov.pk', 'edu.pk',
  'com.ng', 'org.ng', 'net.ng', 'gov.ng', 'edu.ng',
  'com.ke', 'org.ke', 'net.ke', 'go.ke', 'ac.ke',
  'com.gh', 'org.gh', 'net.gh', 'gov.gh', 'edu.gh',
  'com.ua', 'org.ua', 'net.ua', 'gov.ua', 'edu.ua',
  'com.pl', 'org.pl', 'net.pl', 'gov.pl', 'edu.pl',
  'co.il', 'org.il', 'net.il', 'gov.il', 'ac.il',
  'com.ar', 'org.ar', 'net.ar', 'gob.ar', 'edu.ar',
  'com.co', 'org.co', 'net.co', 'gov.co', 'edu.co',
  'com.pe', 'org.pe', 'net.pe', 'gob.pe', 'edu.pe',
  'com.ec', 'org.ec', 'net.ec', 'gob.ec', 'edu.ec',
  'com.ve', 'org.ve', 'net.ve', 'gob.ve', 'edu.ve',
  'com.py', 'org.py', 'net.py', 'gov.py', 'edu.py',
  'com.uy', 'org.uy', 'net.uy', 'gub.uy', 'edu.uy',
  'com.do', 'org.do', 'net.do', 'gob.do', 'edu.do',
  'com.pa', 'org.pa', 'net.pa', 'gob.pa', 'edu.pa',
  'com.cr', 'org.cr', 'net.cr', 'go.cr', 'ac.cr',
  'com.bo', 'org.bo', 'net.bo', 'gob.bo', 'edu.bo',
  'com.ni', 'org.ni', 'net.ni', 'gob.ni', 'edu.ni',
  'com.gt', 'org.gt', 'net.gt', 'gob.gt', 'edu.gt',
  'com.sv', 'org.sv', 'net.sv', 'gob.sv', 'edu.sv',
  'com.hn', 'org.hn', 'net.hn', 'gob.hn', 'edu.hn',
  'co.ve', 'com.mm', 'com.kh', 'com.la', 'com.np', 'com.bd',
  'com.lk', 'com.mv', 'com.bn', 'com.kw', 'com.qa', 'com.om',
  'com.bh', 'com.jo', 'com.lb', 'com.sy', 'com.ly', 'com.mt',
  'com.cy', 'com.gr', 'com.pt', 'com.es', 'com.fr', 'com.de',
  'com.it', 'com.nl', 'com.be', 'com.at', 'com.ch', 'com.se',
  'com.no', 'com.dk', 'com.fi', 'com.ie', 'com.ro', 'com.bg',
  'com.hu', 'com.cz', 'com.sk', 'com.si', 'com.hr', 'com.ba',
  'com.rs', 'com.mk', 'com.al', 'com.ge', 'com.am', 'com.az',
  'com.kz', 'com.uz', 'com.tj', 'com.kg', 'com.tm', 'com.mn',
  'com.mo', 'com.ps', 'com.sd', 'com.et', 'com.tz', 'com.ug',
  'com.mw', 'com.mz', 'com.ao', 'com.cm', 'com.ci', 'com.sn',
  'com.ml', 'com.bj', 'com.tg', 'com.ne', 'com.gm', 'com.sl',
  'com.lr', 'com.gn', 'com.cf', 'com.cg', 'com.ga', 'com.td',
  'com.so', 'com.dj', 'com.er', 'com.rw', 'com.bi', 'com.mg',
  'com.mu', 'com.sc', 'com.fj', 'com.pg', 'com.sb', 'com.ws',
  'com.to', 'com.nu', 'com.ck', 'com.tv', 'com.pf', 'com.nc',
  // African co.* / or.* registrable zones.
  'co.ke', 'or.ke', 'ne.ke', 'co.ug', 'or.ug', 'ne.ug', 'sc.ug',
  'co.tz', 'or.tz', 'ne.tz', 'sc.tz', 'co.rw', 'co.bw', 'co.na',
  'co.zm', 'co.zw', 'co.mw', 'co.mz', 'co.sz', 'co.ls', 'co.bi',
  'co.ao', 'co.mg', 'co.mu', 'co.sc', 'co.sn', 'co.ci',
  // Central-American registrable zones.
  'co.cr', 'co.ni', 'co.sv', 'co.hn', 'co.gt', 'co.do', 'co.py', 'co.uy', 'co.ec'
])

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

// Upper bound on cookies stored in one jar. Session cookies never expire,
// so an adversarial server could otherwise grow memory without bound; the
// oldest stored cookie is dropped when the cap is exceeded.
const MAX_COOKIES = 1000

// A memory-backed jar with the sync API of a tough-cookie CookieJar.
class CookieJar {
  constructor () {
    this._cookies = []
  }

  // Drop expired cookies so a server rotating cookie names (session tokens,
  // per-request nonces) cannot grow the jar without bound.
  _pruneExpired () {
    const now = Date.now()
    this._cookies = this._cookies.filter(function (cookie) {
      return !(cookie.expires && cookie.expires.getTime() < now)
    })
  }

  // Keep the jar bounded: a server can keep setting fresh session cookies
  // forever (they never expire, so pruning alone cannot bound the jar).
  // When the cap is hit the oldest stored cookie is dropped.
  _enforceCap () {
    if (this._cookies.length > MAX_COOKIES) {
      this._cookies.splice(0, this._cookies.length - MAX_COOKIES)
    }
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
      // full public-suffix list, single-label domains ("com", "net", ...)
      // and common two-label public suffixes ("co.uk", "com.au", ...) are
      // rejected unless they are the request host itself, closing the
      // `Domain=com` / `Domain=co.uk`-style poisoning variants.
      const host = uri.hostname.toLowerCase()
      const domain = cookie.domain.toLowerCase()
      const domainMatches = host === domain || host.endsWith('.' + domain)
      if (!domainMatches) {
        return
      }
      if (domain.indexOf('.') === -1 && host !== domain) {
        return
      }
      if (host !== domain && domain.split('.').length <= 2 &&
        TWO_PART_PUBLIC_SUFFIXES.has(domain)) {
        return
      }
    }
    if (!cookie.path) {
      cookie.path = defaultPath(uri.pathname)
    }
    // An unparseable Max-Age (e.g. "Max-Age=abc") is not a session cookie:
    // the server clearly wanted an expiry it could not express. Keeping it
    // forever would poison the jar; drop it instead.
    if (cookie.maxAge !== null && isNaN(cookie.maxAge)) {
      return
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
    this._enforceCap()
  }

  getCookiesSync (url) {
    this._pruneExpired()
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
