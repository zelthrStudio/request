'use strict'

const crypto = require('crypto')
const stream = require('stream')
const helpers = require('../util').helpers

const isstream = helpers.isstream

function sanitizeHeaderValue (value) {
  let out = String(value).replace(/[\r\n]/g, '')
  for (let i = 0; i < out.length; i++) {
    const code = out.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) {
      out = out.slice(0, i) + out.slice(i + 1)
      i--
    }
  }
  return out
}

function combinedStream (parts) {
  const out = new stream.PassThrough()
  let i = 0

  const next = function () {
    if (i >= parts.length) {
      out.end()
      return
    }
    const part = parts[i++]
    if (Buffer.isBuffer(part)) {
      out.write(part)
      next()
    } else if (typeof part === 'string') {
      out.write(Buffer.from(part))
      next()
    } else if (part && part.pipe) {
      part.once('error', function (err) {
        out.destroy(err)
      })
      part.once('end', next)
      part.pipe(out, { end: false })
    } else {
      next()
    }
  }

  next()
  return out
}

function Multipart (request) {
  this.request = request
  this.boundary = crypto.randomBytes(16).toString('hex')
  this.chunked = false
  this.body = null
}

Multipart.prototype.isChunked = function (options) {
  const self = this
  let chunked = false
  const parts = options.data || options

  if (!parts.forEach) {
    self.request.onRequestError(new Error('Argument error, options.multipart.'))
  }

  if (options.chunked !== undefined) {
    chunked = options.chunked
  }

  if (self.request.getHeader('transfer-encoding') === 'chunked') {
    chunked = true
  }

  if (!chunked) {
    parts.forEach(function (part) {
      if (typeof part.body === 'undefined') {
        self.request.onRequestError(new Error('Body attribute missing in multipart.'))
      }
      if (isstream(part.body)) {
        chunked = true
      }
    })
  }

  return chunked
}

Multipart.prototype.setHeaders = function (chunked) {
  const self = this

  if (chunked && !self.request.hasHeader('transfer-encoding')) {
    self.request.setHeader('transfer-encoding', 'chunked')
  }

  const header = self.request.getHeader('content-type')

  if (!header || header.indexOf('multipart') === -1) {
    self.request.setHeader('content-type', 'multipart/related; boundary=' + self.boundary)
  } else {
    if (header.indexOf('boundary') !== -1) {
      self.boundary = header.replace(/.*boundary=([^\s;]+).*/, '$1')
    } else {
      self.request.setHeader('content-type', header + '; boundary=' + self.boundary)
    }
  }
}

Multipart.prototype.build = function (parts, chunked) {
  const self = this
  const body = []

  const add = function (part) {
    if (typeof part === 'number') {
      part = part.toString()
    }
    body.push(Buffer.from(part))
  }

  if (self.request.preambleCRLF) {
    add('\r\n')
  }

  parts.forEach(function (part) {
    let preamble = '--' + self.boundary + '\r\n'
    for (const key of Object.keys(part)) {
      if (key === 'body') {
        continue
      }
      preamble += sanitizeHeaderValue(key) + ': ' + sanitizeHeaderValue(part[key]) + '\r\n'
    }
    preamble += '\r\n'
    add(preamble)
    body.push(typeof part.body === 'string' || typeof part.body === 'number'
      ? Buffer.from(String(part.body))
      : part.body)
    add('\r\n')
  })
  add('--' + self.boundary + '--')

  if (self.request.postambleCRLF) {
    add('\r\n')
  }

  return chunked ? combinedStream(body) : body
}

Multipart.prototype.onRequest = function (options) {
  const self = this

  const chunked = self.isChunked(options)
  const parts = options.data || options

  self.setHeaders(chunked)
  self.chunked = chunked
  self.body = self.build(parts, chunked)
}

exports.Multipart = Multipart
