'use strict'

// Modified by zelthrStudio (2026) from the original `request` package
// (Copyright 2010-2012 Mikeal Rogers, Apache License 2.0).

const isUrl = /^https?:/i

function Redirect (request) {
  this.request = request
  this.followRedirect = true
  this.followRedirects = true
  this.followAllRedirects = false
  this.followOriginalHttpMethod = false
  this.allowRedirect = function () { return true }
  this.maxRedirects = 10
  this.redirects = []
  this.redirectsFollowed = 0
  this.removeRefererHeader = false
}

Redirect.prototype.onRequest = function (options) {
  const self = this

  if (options.maxRedirects !== undefined) {
    self.maxRedirects = options.maxRedirects
  }
  if (typeof options.followRedirect === 'function') {
    self.allowRedirect = options.followRedirect
  }
  if (options.followRedirect !== undefined) {
    self.followRedirects = !!options.followRedirect
  }
  if (options.followAllRedirects !== undefined) {
    self.followAllRedirects = options.followAllRedirects
  }
  if (options.removeRefererHeader !== undefined) {
    self.removeRefererHeader = options.removeRefererHeader
  }
  if (options.followOriginalHttpMethod !== undefined) {
    self.followOriginalHttpMethod = options.followOriginalHttpMethod
  }
}

Redirect.prototype.redirectTo = function (response) {
  const self = this
  const request = self.request

  let redirectTo = null
  if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
    const location = response.headers.location
    request.debug('redirect', location)

    // Some servers emit angle-bracketed Location values ('<http://x>').
    // WHATWG URL parsing treats them as a relative path, silently sending
    // the client to a garbage URL; treat them as no redirect instead.
    if (/[<>]/.test(String(location))) {
      request.debug('ignoring invalid redirect location', location)
      return null
    }

    if (self.followAllRedirects) {
      redirectTo = location
    } else if (self.followRedirects) {
      switch (request.method) {
        case 'PATCH':
        case 'PUT':
        case 'POST':
        case 'DELETE':
          // Do not follow redirects for these methods.
          break
        default:
          redirectTo = location
          break
      }
    }
  } else if (response.statusCode === 401) {
    const authHeader = request._auth.onResponse(response)
    if (authHeader) {
      request.setHeader('authorization', authHeader)
      redirectTo = request.uri
    }
  }
  return redirectTo
}

Redirect.prototype.onResponse = function (response) {
  const self = this
  const request = self.request

  const redirectTo = self.redirectTo(response)
  if (!redirectTo || !self.allowRedirect.call(request, response)) {
    return false
  }

  request.debug('redirect to', redirectTo)

  // Ignore any potential response body. It cannot possibly be useful here.
  if (response.resume) {
    response.resume()
  }

  if (self.redirectsFollowed >= self.maxRedirects) {
    request.emit('error', new Error('Exceeded maxRedirects. Probably stuck in a redirect loop ' + request.uri.href))
    return false
  }
  self.redirectsFollowed += 1

  const uriPrev = request.uri
  let nextUri
  try {
    nextUri = isUrl.test(redirectTo) ? new URL(redirectTo) : new URL(redirectTo, uriPrev.href)
  } catch (e) {
    // A malformed Location must not crash the process through an unhandled
    // promise rejection: surface it as a request error instead.
    request.debug('invalid redirect location', redirectTo)
    request.onRequestError(new Error('Invalid redirect location "' + redirectTo + '": ' + e.message))
    return false
  }
  request.uri = nextUri

  // Handle the case where we change protocol from https to http or vice versa.
  if (request.uri.protocol !== uriPrev.protocol) {
    delete request.agent
  }

  self.redirects.push({ statusCode: response.statusCode, redirectUri: redirectTo })

  // 308 (like 307) must preserve the original method and body; every other
  // redirect coerces POST -> GET unless followOriginalHttpMethod is set.
  if (self.followAllRedirects && request.method !== 'HEAD' &&
    response.statusCode !== 401 && response.statusCode !== 307 && response.statusCode !== 308) {
    request.method = self.followOriginalHttpMethod ? request.method : 'GET'
  }

  // 307/308 preserve the method and body, but a streamed body (piped or
  // written) has already been consumed by the first attempt: retrying would
  // silently send an empty body. Fail loudly instead.
  if ((response.statusCode === 307 || response.statusCode === 308) &&
    (request.src || request._hasWrites)) {
    request.onRequestError(new Error('Cannot follow a ' + response.statusCode +
      ' redirect: the streamed request body has already been consumed'))
    return false
  }

  delete request.src
  delete request.req
  delete request._started
  delete request._bodyStream
  delete request._hasWrites
  delete request._retryAttempts
  if (response.statusCode !== 401 && response.statusCode !== 307 && response.statusCode !== 308) {
    // Remove parameters from the previous response, unless this is a re-request
    // for a server that requires digest authentication.
    delete request.body
    delete request._form
    if (request.headers) {
      request.removeHeader('content-type')
      request.removeHeader('content-length')
    }
  }
  // Remove authorization and cookies when changing hostnames (but not if
  // just changing ports or protocols): the redirect target must not receive
  // credentials scoped to the original host. Matches the behavior of curl.
  // This applies to every redirect status — including 307/308, which preserve
  // the method and body but must still not forward credentials cross-host.
  if (request.headers && request.originalHost && request.uri.hostname !== request.originalHost.split(':')[0]) {
    request.removeHeader('authorization')
    request.removeHeader('cookie')
  }

  // Only forward a Referer to the same hostname: leaking the previous URL
  // (which may carry signed tokens / query secrets) to a redirect target on a
  // different host is a credential-disclosure risk. Set removeRefererHeader
  // to suppress it entirely.
  if (!self.removeRefererHeader && request.uri.hostname === uriPrev.hostname) {
    // Credentials in the previous URL must not leak into the Referer, and a
    // fragment is never part of the referent document.
    const referer = new URL(uriPrev.href)
    referer.username = ''
    referer.password = ''
    referer.hash = ''
    request.setHeader('referer', referer.href)
  }

  request.emit('redirect')

  request.init()

  return true
}

exports.Redirect = Redirect
