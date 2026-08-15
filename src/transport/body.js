'use strict'

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

// Shared request-body handling for HTTP/1.1 and HTTP/2 transports. Also
// marks whether the body is replayable (string/Buffer/array/none), which the
// retry logic uses to decide whether a request can safely be re-sent.

function writeBody (self, req) {
  if (self._hasWrites || self.src) {
    // Streamed bodies (piped or from a stream option) are not replayable.
    self._bodyReplayable = false
    self._bodyStream.pipe(req)
    return
  }

  const body = self.body
  if (body !== undefined && typeof body !== 'string' && !Buffer.isBuffer(body) && !Array.isArray(body)) {
    self._bodyReplayable = false
    req.end()
    return
  }

  self._bodyReplayable = true
  if (body !== undefined && (typeof body === 'string' || Buffer.isBuffer(body))) {
    req.end(body)
  } else if (Array.isArray(body)) {
    req.end(Buffer.concat(body.map(function (part) {
      return Buffer.isBuffer(part) ? part : Buffer.from(String(part))
    })))
  } else {
    req.end()
  }
}

module.exports = { writeBody }
