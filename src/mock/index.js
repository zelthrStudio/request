'use strict'

let enabled = true
const handlers = []

function matches (matcher, self) {
  if (typeof matcher === 'function') {
    return !!matcher(self.uri, self)
  }
  if (matcher instanceof RegExp) {
    matcher.lastIndex = 0
    return matcher.test(self.uri.href)
  }
  if (typeof matcher === 'string') {
    return self.uri.href.indexOf(matcher) !== -1
  }
  return false
}

function add (matcher, handler) {
  handlers.push({ matcher, handler })
}

function clear () {
  handlers.length = 0
}

const reset = clear

function enable () {
  if (process.env.NODE_ENV !== 'test') {
    console.warn('[request] mock layer enabled outside a test environment (NODE_ENV !== "test"): responses will be served from mocks. Call request.mock.disable() before serving real traffic.')
  }
  enabled = true
}

function disable () {
  enabled = false
}

function resolve (self) {
  if (!enabled) {
    return null
  }
  if (self.mock !== undefined) {
    if (typeof self.mock === 'function') {
      return Promise.resolve(self.mock(self.uri, self)).then(function (result) {
        return result || null
      })
    }
    return self.mock
  }
  if (handlers.length === 0) {
    // Fast path: no global handlers registered, nothing to match. Returning
    // a plain value (instead of an async Promise) avoids per-request
    // allocation on the overwhelmingly common no-mock case.
    return null
  }
  return resolveHandlers(self, 0)
}

function resolveHandlers (self, index) {
  while (index < handlers.length) {
    const entry = handlers[index]
    index++
    if (!matches(entry.matcher, self)) {
      continue
    }
    const result = entry.handler(self.uri, self)
    if (result && typeof result.then === 'function') {
      return result.then(function (value) {
        if (value) {
          return value
        }
        return resolveHandlers(self, index)
      })
    }
    if (result) {
      return result
    }
  }
  return null
}

module.exports = { add, clear, reset, enable, disable, resolve }
