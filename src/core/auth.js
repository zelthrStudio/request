'use strict'

// Modified by zelthrStudio (2026) from the original `request` package
// (Copyright 2010-2012 Mikeal Rogers, Apache License 2.0).

const crypto = require('crypto')
const helpers = require('../util').helpers

const md5 = helpers.md5
const toBase64 = helpers.toBase64
const caseless = helpers.caseless

function Auth (request) {
  this.request = request
  this.hasAuth = false
  this.sentAuth = false
  this.bearerToken = null
  this.user = null
  this.pass = null
}

Auth.prototype.basic = function (user, pass, sendImmediately) {
  const self = this
  if (typeof user !== 'string' || (pass !== undefined && typeof pass !== 'string')) {
    self.request.emit('error', new Error('auth() received invalid user or password'))
  }
  self.user = user
  self.pass = pass
  self.hasAuth = true
  const header = user + ':' + (pass || '')
  if (sendImmediately || typeof sendImmediately === 'undefined') {
    self.sentAuth = true
    return 'Basic ' + toBase64(header)
  }
}

Auth.prototype.bearer = function (bearer, sendImmediately) {
  const self = this
  self.bearerToken = bearer
  self.hasAuth = true
  if (sendImmediately || typeof sendImmediately === 'undefined') {
    if (typeof bearer === 'function') {
      bearer = bearer()
    }
    self.sentAuth = true
    return 'Bearer ' + (bearer || '')
  }
}

Auth.prototype.digest = function (method, path, authHeader) {
  // RFC 2617 digest authentication (MD5 / MD5-sess with qop=auth).
  const self = this

  const challenge = {}
  const re = /([a-z0-9_-]+)=(?:"([^"]+)"|([a-z0-9_-]+))/gi
  while (true) {
    const match = re.exec(authHeader)
    if (!match) {
      break
    }
    challenge[match[1]] = match[2] || match[3]
  }

  const ha1Compute = function (algorithm, user, realm, pass, nonce, cnonce) {
    const ha1 = md5(user + ':' + realm + ':' + pass)
    if (algorithm && algorithm.toLowerCase() === 'md5-sess') {
      return md5(ha1 + ':' + nonce + ':' + cnonce)
    }
    return ha1
  }

  const qop = /(^|,)\s*auth\s*($|,)/.test(challenge.qop) && 'auth'
  const nc = qop && '00000001'
  const cnonce = qop && crypto.randomBytes(8).toString('hex')
  const ha1 = ha1Compute(challenge.algorithm, self.user, challenge.realm, self.pass, challenge.nonce, cnonce)
  const ha2 = md5(method + ':' + path)
  const digestResponse = qop
    ? md5(ha1 + ':' + challenge.nonce + ':' + nc + ':' + cnonce + ':' + qop + ':' + ha2)
    : md5(ha1 + ':' + challenge.nonce + ':' + ha2)
  const authValues = {
    username: self.user,
    realm: challenge.realm,
    nonce: challenge.nonce,
    uri: path,
    qop,
    response: digestResponse,
    nc,
    cnonce,
    algorithm: challenge.algorithm,
    opaque: challenge.opaque
  }

  authHeader = []
  for (const k of Object.keys(authValues)) {
    if (authValues[k]) {
      if (k === 'qop' || k === 'nc' || k === 'algorithm') {
        authHeader.push(k + '=' + authValues[k])
      } else {
        authHeader.push(k + '="' + authValues[k] + '"')
      }
    }
  }
  authHeader = 'Digest ' + authHeader.join(', ')
  self.sentAuth = true
  return authHeader
}

Auth.prototype.onRequest = function (user, pass, sendImmediately, bearer) {
  const self = this
  const request = self.request

  let authHeader
  if (bearer === undefined && user === undefined) {
    self.request.emit('error', new Error('no auth mechanism defined'))
  } else if (bearer !== undefined) {
    authHeader = self.bearer(bearer, sendImmediately)
  } else {
    authHeader = self.basic(user, pass, sendImmediately)
  }
  if (authHeader) {
    request.setHeader('authorization', authHeader)
  }
}

Auth.prototype.onResponse = function (response) {
  const self = this
  const request = self.request

  if (!self.hasAuth || self.sentAuth) {
    return null
  }

  const c = caseless(response.headers)
  const authHeader = c.get('www-authenticate')
  const authVerb = authHeader && authHeader.split(' ')[0].toLowerCase()
  request.debug('reauth', authVerb)

  switch (authVerb) {
    case 'basic':
      return self.basic(self.user, self.pass, true)

    case 'bearer':
      return self.bearer(self.bearerToken, true)

    case 'digest':
      return self.digest(request.method, request.path, authHeader)
  }
}

exports.Auth = Auth
