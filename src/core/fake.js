'use strict'

const stream = require('stream')

const { responseToJSON } = require('../util').serialization

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
