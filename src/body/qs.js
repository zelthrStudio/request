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

  // `ancestors` tracks the object graph currently being visited, so a
  // circular reference raises a clear error instead of overflowing the
  // call stack.
  const visit = function (prefix, value, ancestors) {
    if (value === null || value === undefined) {
      return
    }
    if (typeof value === 'object') {
      if (ancestors.has(value)) {
        throw new TypeError('Cannot stringify a circular object at "' + prefix + '"')
      }
      ancestors.add(value)
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        parts.push(encode(prefix) + eq + '')
        return
      }
      value.forEach(function (item, index) {
        visit(prefix + '[' + index + ']', item, ancestors)
      })
      ancestors.delete(value)
      return
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value)
      if (keys.length === 0) {
        parts.push(encode(prefix) + eq + '')
        return
      }
      keys.forEach(function (key) {
        visit(prefix + '[' + key + ']', value[key], ancestors)
      })
      ancestors.delete(value)
      return
    }
    parts.push(encode(prefix) + eq + encode(value))
  }

  const ancestors = new Set()
  Object.keys(obj).forEach(function (key) {
    visit(key, obj[key], ancestors)
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

  // Prototype-pollution guard: skip any key whose bracket path touches
  // __proto__ / constructor / prototype, at any nesting depth.
  const unsafeKey = /(^|\[)(__proto__|constructor|prototype)(\]|\[|$)/i

  const append = function (target, key, value) {
    if (key === '') {
      return
    }
    // hasOwnProperty (not a truthiness check): an inherited property such
    // as `toString` must not be treated as an existing value, which would
    // corrupt parsed output into a [function, value] pair.
    if (!Object.prototype.hasOwnProperty.call(target, key)) {
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
    if (unsafeKey.test(key)) {
      continue
    }

    const keys = key.split('[')
    let target = result
    for (let i = 0; i < keys.length - 1; i++) {
      let k = keys[i]
      if (k.slice(-1) === ']') {
        k = k.slice(0, -1)
      }
      const nextKey = keys[i + 1].replace(/\]/g, '')
      // Only allocate when nothing is there yet: re-wrapping an existing
      // array would wipe values already parsed by earlier pairs
      // (a[0]=1&a[1]=2 must yield ['1','2'], not ['2']).
      if (target[k] === undefined) {
        target[k] = (nextKey === '' || /^\d+$/.test(nextKey)) ? [] : {}
      } else if (typeof target[k] !== 'object') {
        target[k] = (nextKey === '' || /^\d+$/.test(nextKey)) ? [target[k]] : {}
      } else if (Array.isArray(target[k]) && nextKey !== '' && !/^\d+$/.test(nextKey)) {
        // a[0]=1&a[x]=2 -> { '0': '1', x: '2' }: keep the numeric entries
        // while switching to an object for the non-index key.
        const obj = {}
        target[k].forEach(function (item, index) {
          obj[index] = item
        })
        target[k] = obj
      }
      target = target[k]
    }
    let last = keys[keys.length - 1]
    if (last.slice(-1) === ']') {
      last = last.slice(0, -1)
    }
    if (last === '') {
      // Root-level empty key ('=value'): nothing sensible to attach it to,
      // so skip it instead of crashing on result.push().
      if (Array.isArray(target)) {
        target.push(value)
      }
    } else {
      append(target, last, value)
    }
  }
  return result
}

module.exports = { stringify, parse }
