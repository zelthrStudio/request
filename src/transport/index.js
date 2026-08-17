'use strict'

const http1 = require('./http1')
const http2 = require('./http2')
const { getAgent, closeDisposableAgent, closePool } = require('./pool')
const { connectOptions, connectSignature } = require('./tls')
const { writeBody } = require('./body')
const { makeTimeoutError, makeAbortError, makeBodyLimitError, isAbortError } = require('./errors')

exports.dispatch = http1.dispatch
exports.mapTimeoutError = http1.mapTimeoutError
exports.makeTimeoutError = makeTimeoutError
exports.makeAbortError = makeAbortError
exports.makeBodyLimitError = makeBodyLimitError
exports.isAbortError = isAbortError
exports.dispatchHttp2 = http2.dispatch
exports.closeSessions = http2.closeSessions
exports.getAgent = getAgent
exports.closeDisposableAgent = closeDisposableAgent
exports.closePool = closePool
exports.connectOptions = connectOptions
exports.connectSignature = connectSignature
exports.writeBody = writeBody
