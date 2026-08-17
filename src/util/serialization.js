'use strict'

const SENSITIVE_HEADER_RE = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey)$/i

function requestToJSON () {
  const headers = {}
  for (const key of Object.keys(this.headers || {})) {
    if (!SENSITIVE_HEADER_RE.test(key)) {
      headers[key] = this.headers[key]
    }
  }
  let uri = this.uri
  if (uri instanceof URL && (uri.username || uri.password)) {
    uri = new URL(uri.href)
    uri.username = ''
    uri.password = ''
  }
  return {
    uri,
    method: this.method,
    headers
  }
}

function responseToJSON () {
  const headers = {}
  for (const key of Object.keys(this.headers || {})) {
    if (!SENSITIVE_HEADER_RE.test(key)) {
      headers[key] = this.headers[key]
    }
  }
  return {
    statusCode: this.statusCode,
    body: this.body,
    headers,
    request: requestToJSON.call(this.request)
  }
}

module.exports = { requestToJSON, responseToJSON }
