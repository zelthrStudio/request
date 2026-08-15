'use strict'

// Modified by zelthrStudio (2026) from the original `request` package
// (Copyright 2010-2012 Mikeal Rogers, Apache License 2.0).

// Return a simpler request object to allow serialization.
function requestToJSON () {
  return {
    uri: this.uri,
    method: this.method,
    headers: this.headers
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
