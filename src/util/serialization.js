'use strict'

// Modified by zelthrStudio (2026) from the original `request` package
// (Copyright 2010-2012 Mikeal Rogers, Apache License 2.0).

// Headers never serialized: logging a request/response object must not leak
// credentials (Authorization/Bearer), cookies or API keys.
const SENSITIVE_HEADER_RE = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey)$/i

// Return a simpler request object to allow serialization.
function requestToJSON () {
  const headers = {}
  for (const key of Object.keys(this.headers || {})) {
    if (!SENSITIVE_HEADER_RE.test(key)) {
      headers[key] = this.headers[key]
    }
  }
  return {
    uri: this.uri,
    method: this.method,
    headers
  }
}

// Return a simpler response object to allow serialization.
function responseToJSON () {
  return {
    statusCode: this.statusCode,
    body: this.body,
    headers: this.headers,
    request: requestToJSON.call(this.request)
  }
}

module.exports = { requestToJSON, responseToJSON }
