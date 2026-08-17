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
