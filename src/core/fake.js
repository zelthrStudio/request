'use strict'

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

const stream = require('stream')

const { responseToJSON } = require('../util').serialization

// Build a synthetic response stream (statusCode, headers, body) that flows
// through the normal response pipeline. Used by the mocking layer and the
// RFC 7234 cache when serving a stored response without touching the network.
function makeResponse (self, spec) {
  let body = spec.body
  if (body === undefined || body === null) {
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
    // A mock body must be a replayable value. A plain object (e.g. a
    // handler that returns `{ body: { foo: 1 } }`) would otherwise become
    // a silently empty body; fail loudly so the mismatch is caught where
    // the mock is defined.
    throw new Error('mock response body must be a string, Buffer, or stream (got ' + (body === null ? 'null' : typeof body) + ')')
  }
  response.statusCode = spec.statusCode !== undefined ? spec.statusCode : 200
  response.headers = spec.headers || {}
  response.httpVersion = spec.httpVersion || '1.1'
  response.request = self
  response.toJSON = responseToJSON
  return response
}

module.exports = { makeResponse }
