'use strict'

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

// Minimal qs-compatible query string encoder/decoder. Supports nested
// objects and arrays using bracket notation (a[b]=c, a[0]=x), with
// configurable separators. Replaces the `qs` package for the common cases
// request exposes (qs, form, qsParseOptions/qsStringifyOptions).

function encode (str) {
  return encodeURIComponent(String(str)).replace(/[!'()*]/g, function (c) {
    return '%' + c.charCodeAt(0).toString(16).toUpperCase()
  })
}

function decode (str) {
  try {
    return decodeURIComponent(str.replace(/\+/g, ' '))
  } catch (e) {
    return str
  }
}

function stringify (obj, options) {
  options = options || {}
  const sep = options.sep || '&'
  const eq = options.eq || '='
  const parts = []

  const visit = function (prefix, value) {
    if (value === null || value === undefined) {
      return
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        parts.push(encode(prefix) + eq + '')
        return
      }
      value.forEach(function (item, index) {
        visit(prefix + '[' + index + ']', item)
      })
      return
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value)
      if (keys.length === 0) {
        parts.push(encode(prefix) + eq + '')
        return
      }
      keys.forEach(function (key) {
        visit(prefix + '[' + key + ']', value[key])
      })
      return
    }
    parts.push(encode(prefix) + eq + encode(value))
  }

  Object.keys(obj).forEach(function (key) {
    visit(key, obj[key])
  })
  return parts.join(sep)
}

function parse (str, options) {
  options = options || {}
  const sep = options.sep || '&'
  const eq = options.eq || '='
  const result = {}
  if (typeof str !== 'string' || str.length === 0) {
    return result
  }

  const append = function (target, key, value) {
    if (key === '') {
      return
    }
    if (target[key] === undefined) {
      target[key] = value
    } else if (Array.isArray(target[key])) {
      target[key].push(value)
    } else {
      target[key] = [target[key], value]
    }
  }

  for (const pair of str.split(sep)) {
    if (!pair) {
      continue
    }
    const idx = pair.indexOf(eq)
    const rawKey = idx === -1 ? pair : pair.slice(0, idx)
    const rawValue = idx === -1 ? '' : pair.slice(idx + 1)
    const key = decode(rawKey)
    const value = decode(rawValue)

    const keys = key.split('[')
    let target = result
    for (let i = 0; i < keys.length - 1; i++) {
      let k = keys[i]
      if (k.slice(-1) === ']') {
        k = k.slice(0, -1)
      }
      const nextKey = keys[i + 1].replace(/\]/g, '')
      if (target[k] === undefined || typeof target[k] !== 'object' || Array.isArray(target[k])) {
        target[k] = (nextKey === '' || /^\d+$/.test(nextKey)) ? [] : {}
      }
      target = target[k]
    }
    let last = keys[keys.length - 1]
    if (last.slice(-1) === ']') {
      last = last.slice(0, -1)
    }
    if (last === '') {
      target.push(value)
    } else {
      append(target, last, value)
    }
  }
  return result
}

module.exports = { stringify, parse }
