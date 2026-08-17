'use strict'

const helpers = require('./util').helpers
const cookies = require('./cookie')
const { closePool } = require('./transport')

const extend = helpers.extend
const paramsHaveRequestBody = helpers.paramsHaveRequestBody

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

request.cache = require('./cache').defaultCache
request.mock = require('./mock')

request.reset = function () {
  request.mock.reset()
}

request.promise = function (uri, options) {
  try {
    return Promise.resolve(request(uri, options))
  } catch (err) {
    return Promise.reject(err)
  }
}

function promiseVerbFunc (verb) {
  const method = verb.toUpperCase()
  return function (uri, options) {
    const params = initParams(uri, options)
    params.method = method
    delete params.callback
    return request.promise(params)
  }
}

request.promise.get = promiseVerbFunc('get')
request.promise.head = promiseVerbFunc('head')
request.promise.options = promiseVerbFunc('options')
request.promise.post = promiseVerbFunc('post')
request.promise.put = promiseVerbFunc('put')
request.promise.patch = promiseVerbFunc('patch')
request.promise.del = promiseVerbFunc('delete')
request.promise.delete = promiseVerbFunc('delete')

const sleep = function (ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

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
    const nextValue = body.next
    if (typeof nextValue === 'string' || typeof nextValue === 'number' || typeof nextValue === 'boolean') {
      try {
        return new URL(String(nextValue), currentUrl).href
      } catch (e) {
        return null
      }
    }
  }
  return null
}

function originOf (url, base) {
  try {
    return new URL(url, base).origin
  } catch (e) {
    return null
  }
}

request.paginate = async function * (uri, options) {
  options = options || {}
  const pagination = options.paginate || {}

  const transform = typeof pagination.transform === 'function'
    ? pagination.transform
    : function (response) { return response.body }
  const filter = typeof pagination.filter === 'function' ? pagination.filter : null
  const shouldContinue = typeof pagination.shouldContinue === 'function' ? pagination.shouldContinue : null
  const nextUrl = typeof pagination.nextUrl === 'function' ? pagination.nextUrl : defaultNextUrl
  const countLimit = pagination.countLimit === undefined ? 1000 : pagination.countLimit
  const requestLimit = pagination.requestLimit === undefined ? 100 : pagination.requestLimit
  const backoff = pagination.backoff || 0
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

  const verbs = ['get', 'head', 'options', 'post', 'put', 'patch', 'del', 'delete']
  verbs.forEach(function (verb) {
    defaults[verb] = wrapRequestMethod(self[verb], options, requester, verb)
  })

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

  verbs.forEach(function (verb) {
    defaults.promise[verb] = function (uri, opts) {
      const params = initParams(uri, opts)
      const target = {}
      extend(true, target, options, params)
      target.method = verb === 'del' ? 'DELETE' : verb.toUpperCase()
      delete target.callback
      return request.promise(target)
    }
  })

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

module.exports = request
request.Request = require('./core').Request
request.initParams = initParams

Object.defineProperty(request, 'debug', {
  enumerable: true,
  get: function () {
    return request.Request.debug
  },
  set: function (debug) {
    request.Request.debug = debug
  }
})
