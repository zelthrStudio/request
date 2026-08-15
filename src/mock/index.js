'use strict'

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

// Mocking layer: intercept requests before they hit the network, either via
// a per-request `mock` option or globally through request.mock.add().
//
// A matcher can be a function (uri, request) => boolean, a RegExp tested
// against the full URL, or a string substring of the URL. The handler
// receives (uri, request) and returns a response spec:
// { statusCode, headers, body } - or null/falsy to pass through to the
// network. Handlers may be async.

let enabled = true
const handlers = []

function matches (matcher, self) {
  if (typeof matcher === 'function') {
    return !!matcher(self.uri, self)
  }
  if (matcher instanceof RegExp) {
    // A /g (or /y) regex keeps its lastIndex between test() calls and
    // alternates matches; reset it so matching is stateless.
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

// Alias of clear(): the escape hatch for tests that registered mocks
// without tracking them, so a leaked mock can never silently shape later
// tests (or production calls).
const reset = clear

function enable () {
  // A mock left on in production silently serves fake responses to real
  // traffic. Tests enable mocks deliberately; anything else is a leak risk.
  if (process.env.NODE_ENV !== 'test') {
    // eslint-disable-next-line no-console
    console.warn('[request] mock layer enabled outside a test environment (NODE_ENV !== "test"): responses will be served from mocks. Call request.mock.disable() before serving real traffic.')
  }
  enabled = true
}

function disable () {
  enabled = false
}

// Resolve a mock for this request. Returns a response spec or null when the
// request should go to the network.
async function resolve (self) {
  if (!enabled) {
    return null
  }
  if (self.mock !== undefined) {
    if (typeof self.mock === 'function') {
      const result = await self.mock(self.uri, self)
      if (result) {
        return result
      }
    } else {
      return self.mock
    }
  }
  for (const entry of handlers) {
    if (matches(entry.matcher, self)) {
      const result = await entry.handler(self.uri, self)
      if (result) {
        return result
      }
    }
  }
  return null
}

module.exports = { add, clear, reset, enable, disable, resolve }
