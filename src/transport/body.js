'use strict'

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

// Shared request-body handling for HTTP/1.1 and HTTP/2 transports. Also
// marks whether the body is replayable (string/Buffer/array/none), which the
// retry logic uses to decide whether a request can safely be re-sent.

const { emitProgress } = require('../util').progress

function writeBody (self, req) {
  if (self._hasWrites || self.src) {
    // Streamed bodies (piped or from a stream option) are not replayable.
    self._bodyReplayable = false
    self._bodyStream.pipe(req)
    // Count upload bytes only after piping: attaching a 'data' listener
    // before pipe() would switch the stream to flowing mode and the buffered
    // chunks would be delivered to the listener instead of the request.
    if (self.progress) {
      self._bodyStream.on('data', function (chunk) {
        self._progress.uploaded += chunk.length
        emitProgress(self, 'upload')
      })
    }
    return
  }

  const body = self.body
  if (body !== undefined && body !== null && typeof body !== 'string' && !Buffer.isBuffer(body) && !Array.isArray(body)) {
    // A non-replayable, unsupported body type must fail loudly instead of
    // silently sending an empty request body.
    const name = body && body.constructor ? body.constructor.name : typeof body
    const err = new Error('Unsupported request body type "' + name + '": expected a string, Buffer, Array, stream or null')
    self.onRequestError(err)
    if (req && typeof req.destroy === 'function') {
      req.destroy(err)
    }
    return
  }

  self._bodyReplayable = true
  if (body !== undefined && (typeof body === 'string' || Buffer.isBuffer(body))) {
    req.end(body)
    reportUploaded(self, body.length)
  } else if (Array.isArray(body)) {
    const buffer = Buffer.concat(body.map(function (part) {
      return Buffer.isBuffer(part) ? part : Buffer.from(String(part))
    }))
    req.end(buffer)
    reportUploaded(self, buffer.length)
  } else {
    req.end()
    reportUploaded(self, 0)
  }
}

function reportUploaded (self, length) {
  if (!self._progress) {
    return
  }
  self._progress.uploadedTotal = length
  self._progress.uploaded = length
  if (self.progress) {
    emitProgress(self, 'upload')
  }
}

module.exports = { writeBody }
