'use strict'

// Modified by zelthrStudio (2026) from the original `request` package
// (Copyright 2010-2012 Mikeal Rogers, Apache License 2.0).

// Copyright 2010-2012 Mikeal Rogers
//    Licensed under the Apache License, Version 2.0 (the "License");
//    you may not use this file except in compliance with the License.
//    You may obtain a copy of the License at
//
//        http://www.apache.org/licenses/LICENSE-2.0
//
//    Unless required by applicable law or agreed to in writing, software
//    distributed under the License is distributed on an "AS IS" BASIS,
//    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//    See the License for the specific language governing permissions and
//    limitations under the License.

const helpers = require('./util').helpers
const cookies = require('./cookie')
const { closePool } = require('./transport')

const extend = helpers.extend
const paramsHaveRequestBody = helpers.paramsHaveRequestBody

// Organize params for patch, post, put, head, del.
function initParams (uri, options, callback) {
  if (typeof options === 'function') {
    callback = options
  }

  const params = {}
  if (options !== null && typeof options === 'object') {
    extend(params, options, { uri })
  } else if (typeof uri === 'string') {
    extend(params, { uri })
  } else {
    extend(params, uri)
  }

  params.callback = callback || params.callback
  return params
}

function request (uri, options, callback) {
  if (typeof uri === 'undefined') {
    throw new Error('undefined is not a valid uri or options object.')
  }

  const params = initParams(uri, options, callback)

  if (params.method === 'HEAD' && paramsHaveRequestBody(params)) {
    throw new Error('HTTP HEAD requests MUST NOT include a request body.')
  }

  return new request.Request(params)
}

function verbFunc (verb) {
  const method = verb.toUpperCase()
  return function (uri, options, callback) {
    const params = initParams(uri, options, callback)
    params.method = method
    return request(params, params.callback)
  }
}

// Define like this to please codeintel/intellisense IDEs.
request.get = verbFunc('get')
request.head = verbFunc('head')
request.options = verbFunc('options')
request.post = verbFunc('post')
request.put = verbFunc('put')
request.patch = verbFunc('patch')
request.del = verbFunc('delete')
request.delete = verbFunc('delete')

request.jar = function (store) {
  return cookies.jar(store)
}

request.cookie = function (str) {
  return cookies.parse(str)
}

// Shared RFC 7234 cache used by `cache: true`, and the global mocking layer
// used by request.mock.add().
request.cache = require('./cache').defaultCache
request.mock = require('./mock')

// Clear global state (mocked handlers). Tests that registered mocks without
// tracking them can reset here so a leaked mock never shapes later calls.
request.reset = function () {
  request.mock.reset()
}

// Promise interface: the Request is a thenable, but the explicit promise()
// helper reads better and guarantees the response body is collected.
// Construction may throw synchronously (invalid URI, EventEmitter rethrow
// of an emitted 'error' with no listener); reject instead of crashing.
request.promise = function (uri, options) {
  try {
    return Promise.resolve(request(uri, options))
  } catch (err) {
    return Promise.reject(err)
  }
}

const sleep = function (ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

// Default pagination: follow Link rel="next" headers, then body.next.
function defaultNextUrl (response, currentUrl) {
  const link = response.headers && response.headers.link
  if (link) {
    for (const part of String(link).split(',')) {
      const match = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i)
      if (match) {
        return new URL(match[1], currentUrl).href
      }
    }
  }
  const body = response.body
  if (body && typeof body === 'object' && !Buffer.isBuffer(body) && body.next) {
    return new URL(String(body.next), currentUrl).href
  }
  return null
}

// The origin of a URL, or null when it cannot be parsed. Used to refuse
// pagination hops that leave the original origin (SSRF guard).
function originOf (url, base) {
  try {
    return new URL(url, base).origin
  } catch (e) {
    return null
  }
}

// Async generator that follows pagination until the pages run out.
// Options: paginate: { transform, filter, shouldContinue, nextUrl,
// countLimit, requestLimit, backoff, allowCrossOrigin }.
request.paginate = async function * (uri, options) {
  options = options || {}
  const pagination = options.paginate || {}

  const transform = typeof pagination.transform === 'function'
    ? pagination.transform
    : function (response) { return response.body }
  const filter = typeof pagination.filter === 'function' ? pagination.filter : null
  const shouldContinue = typeof pagination.shouldContinue === 'function' ? pagination.shouldContinue : null
  const nextUrl = typeof pagination.nextUrl === 'function' ? pagination.nextUrl : defaultNextUrl
  // Safety caps against runaway pagination (malicious/looping `next` links):
  // raise them via the paginate options when a legitimate job needs more.
  // 0 disables the cap; undefined falls back to the default.
  const countLimit = pagination.countLimit === undefined ? 1000 : pagination.countLimit
  const requestLimit = pagination.requestLimit === undefined ? 100 : pagination.requestLimit
  const backoff = pagination.backoff || 0
  // Cross-origin hops (e.g. an attacker-controlled `next` pointing at an
  // internal host) are refused unless explicitly allowed.
  const allowCrossOrigin = pagination.allowCrossOrigin === true

  let currentUrl = uri
  const origin = originOf(currentUrl)
  let requests = 0
  let count = 0

  while (currentUrl) {
    if (requestLimit && requests >= requestLimit) {
      return
    }
    const response = await request.promise(currentUrl, options)
    requests++

    const items = transform(response)
    if (items !== undefined && items !== null) {
      for (const item of items) {
        if (countLimit && count >= countLimit) {
          return
        }
        if (filter && !filter(item)) {
          continue
        }
        count++
        yield item
      }
    }

    if (shouldContinue && !shouldContinue(response)) {
      return
    }

    const next = await nextUrl(response, currentUrl)
    if (!next) {
      return
    }
    if (!allowCrossOrigin && origin) {
      const nextOrigin = originOf(next, currentUrl)
      if (nextOrigin === null || nextOrigin !== origin) {
        return
      }
    }
    currentUrl = next
    if (backoff) {
      await sleep(backoff)
    }
  }
}

// Close the shared keep-alive pools (useful to let a process exit promptly).
request.closePool = function () {
  return closePool()
}

function wrapRequestMethod (method, options, requester, verb) {
  return function (uri, opts, callback) {
    const params = initParams(uri, opts, callback)

    const target = {}
    extend(true, target, options, params)

    target.pool = params.pool || options.pool

    if (verb) {
      target.method = verb.toUpperCase()
    }

    if (typeof requester === 'function') {
      method = requester
    }

    return method(target, target.callback)
  }
}

request.defaults = function (options, requester) {
  const self = this

  options = options || {}

  if (typeof options === 'function') {
    requester = options
    options = {}
  }

  const defaults = wrapRequestMethod(self, options, requester)

  const verbs = ['get', 'head', 'post', 'put', 'patch', 'del', 'delete']
  verbs.forEach(function (verb) {
    defaults[verb] = wrapRequestMethod(self[verb], options, requester, verb)
  })

  // `cookie` is a pure string parser: wrapping it like the request verbs
  // would hand it the options object and always return null.
  defaults.cookie = self.cookie
  defaults.jar = self.jar
  defaults.defaults = self.defaults

  defaults.promise = function (uri, opts) {
    const params = initParams(uri, opts)
    const target = {}
    extend(true, target, options, params)
    delete target.callback
    return request.promise(target)
  }

  defaults.paginate = function (uri, opts) {
    const params = initParams(uri, opts)
    const target = {}
    extend(true, target, options, params)
    delete target.callback
    return request.paginate(target)
  }

  return defaults
}

request.forever = function (agentOptions, optionsArg) {
  const options = {}
  if (optionsArg) {
    extend(options, optionsArg)
  }
  if (agentOptions) {
    options.agentOptions = agentOptions
  }

  options.forever = true
  return request.defaults(options)
}

// Exports
module.exports = request
request.Request = require('./core').Request
request.initParams = initParams

// Backwards compatibility for request.debug.
Object.defineProperty(request, 'debug', {
  enumerable: true,
  get: function () {
    return request.Request.debug
  },
  set: function (debug) {
    request.Request.debug = debug
  }
})
