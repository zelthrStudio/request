'use strict'

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

const stream = require('stream')

const { responseToJSON } = require('../util').serialization

// Build a synthetic response stream (statusCode, headers, body) that flows
// through the normal response pipeline. Used by the mocking layer and the
// RFC 7234 cache when serving a stored response without touching the network.
function makeResponse (self, spec) {
  let body = spec.body
  if (body === undefined) {
    body = ''
  }
  let response
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    response = new stream.Readable({
      read: function () {
        this.push(body)
        this.push(null)
      }
    })
  } else if (body && body.getReader) {
    response = stream.Readable.fromWeb(body)
  } else if (typeof body.pipe === 'function') {
    response = body
  } else {
    response = new stream.Readable({
      read: function () {
        this.push(null)
      }
    })
  }
  response.statusCode = spec.statusCode !== undefined ? spec.statusCode : 200
  response.headers = spec.headers || {}
  response.httpVersion = spec.httpVersion || '1.1'
  response.request = self
  response.toJSON = responseToJSON
  return response
}

module.exports = { makeResponse }
