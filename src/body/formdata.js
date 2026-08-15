'use strict'

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

const { EventEmitter } = require('events')
const crypto = require('crypto')

// Minimal form-data replacement: multipart/form-data construction with the
// append()/getHeaders()/getLength()/pipe() API, replacing the form-data
// package. Stream values need a knownLength so the body length can be
// computed (matching form-data behavior).

function partHeader (part, boundary) {
  let header = '--' + boundary + '\r\n'
  header += 'Content-Disposition: form-data; name="' + part.name + '"'
  const filename = part.options.filename
  if (filename) {
    header += '; filename="' + filename + '"'
  }
  header += '\r\n'
  const contentType = part.options.contentType
  if (contentType) {
    header += 'Content-Type: ' + contentType + '\r\n'
  }
  header += '\r\n'
  return header
}

function valueLength (part) {
  const value = part.value
  if (typeof value === 'string') {
    return Buffer.byteLength(value)
  }
  if (Buffer.isBuffer(value)) {
    return value.length
  }
  const known = part.options.knownLength
  if (typeof known === 'number') {
    return known
  }
  return null
}

class FormData extends EventEmitter {
  constructor () {
    super()
    this._parts = []
    this._boundary = '----zelthr-' + crypto.randomBytes(12).toString('hex')
  }

  append (name, value, options) {
    this._parts.push({ name: String(name), value, options: options || {} })
    return this
  }

  getHeaders () {
    return { 'content-type': 'multipart/form-data; boundary=' + this._boundary }
  }

  getLength (cb) {
    try {
      let total = 0
      for (const part of this._parts) {
        total += Buffer.byteLength(partHeader(part, this._boundary))
        const length = valueLength(part)
        if (length === null) {
          cb(new Error('Cannot calculate stream length'))
          return
        }
        total += length + 2
      }
      total += Buffer.byteLength('--' + this._boundary + '--\r\n')
      cb(null, total)
    } catch (err) {
      cb(err)
    }
  }

  pipe (dest) {
    const self = this

    const write = function (chunk) {
      return new Promise(function (resolve) {
        if (dest.write(chunk)) {
          resolve()
        } else {
          dest.once('drain', resolve)
        }
      })
    }

    const run = async function () {
      for (const part of self._parts) {
        await write(partHeader(part, self._boundary))
        const value = part.value
        if (typeof value === 'string' || Buffer.isBuffer(value)) {
          await write(value)
        } else if (value && typeof value.pipe === 'function') {
          await new Promise(function (resolve, reject) {
            value.once('error', reject)
            value.once('end', resolve)
            value.pipe(dest, { end: false })
          })
        }
        await write('\r\n')
      }
      dest.end('--' + self._boundary + '--\r\n')
    }

    run().catch(function (err) {
      self.emit('error', err)
      dest.destroy(err)
    })
    return dest
  }
}

module.exports = FormData
