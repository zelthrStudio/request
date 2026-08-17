'use strict'

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
    request.debug('invalid redirect location', redirectTo)
    request.onRequestError(new Error('Invalid redirect location "' + redirectTo + '": ' + e.message))
    return false
  }
  request.uri = nextUri

  if (request.uri.protocol !== uriPrev.protocol) {
    delete request.agent
  }

  self.redirects.push({ statusCode: response.statusCode, redirectUri: redirectTo })

  if (self.followAllRedirects && request.method !== 'HEAD' &&
    response.statusCode !== 401 && response.statusCode !== 307 && response.statusCode !== 308) {
    request.method = self.followOriginalHttpMethod ? request.method : 'GET'
  }

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
    delete request.body
    delete request._form
    if (request.headers) {
      request.removeHeader('content-type')
      request.removeHeader('content-length')
    }
  }
  if (request.headers && request.originalHost && request.uri.hostname !== request.originalHost.split(':')[0]) {
    request.removeHeader('authorization')
    request.removeHeader('cookie')
  }

  if (!self.removeRefererHeader && request.uri.hostname === uriPrev.hostname) {
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
