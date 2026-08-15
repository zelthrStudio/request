'use strict'

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

// Shared error helpers for the native transport.

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

function isAbortError (err) {
  return err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')
}

module.exports = { makeTimeoutError, makeAbortError, isAbortError }
