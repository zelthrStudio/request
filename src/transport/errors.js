'use strict'

function makeTimeoutError (connect) {
  const err = new Error(connect ? 'ETIMEDOUT' : 'ESOCKETTIMEDOUT')
  err.code = connect ? 'ETIMEDOUT' : 'ESOCKETTIMEDOUT'
  err.connect = !!connect
  return err
}

function makeAbortError () {
  const err = new Error('The operation was aborted')
  err.name = 'AbortError'
  err.code = 'ABORT_ERR'
  return err
}

function makeBodyLimitError (limit) {
  const err = new Error('Response body exceeded the maxBytes limit of ' + limit + ' bytes')
  err.code = 'EBODYLIMIT'
  err.maxBytes = limit
  return err
}

function isAbortError (err) {
  return err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')
}

module.exports = { makeTimeoutError, makeAbortError, makeBodyLimitError, isAbortError }
