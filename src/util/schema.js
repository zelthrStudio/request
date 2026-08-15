'use strict'

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

// Response schema validation for the `schema` option. Duck-typing keeps
// the validation libraries as optional peer dependencies (no runtime
// deps): joi exposes .validate(), zod throws from .parse(), valibot
// returns a result object from .safeParse(). A plain function is
// supported too. The validated (possibly transformed) value replaces the
// parsed body.

// A validator that returns a Promise would silently hand the caller a
// Promise as the response body. Validators must be synchronous; reject
// async results loudly instead.
function ensureSync (value) {
  if (value !== null && typeof value === 'object' && typeof value.then === 'function') {
    const err = new Error('Response schema validator returned a Promise; schema validators must be synchronous')
    err.validation = true
    throw err
  }
  return value
}

function validateWithSchema (schema, body) {
  if (typeof schema === 'function') {
    try {
      return ensureSync(schema(body))
    } catch (err) {
      err.validation = true
      throw err
    }
  }
  if (schema && typeof schema.validate === 'function') {
    // joi
    const result = ensureSync(schema.validate(body))
    if (result && result.error) {
      const err = new Error('Response failed schema validation: ' + result.error.message)
      err.validation = true
      throw err
    }
    return result ? ensureSync(result.value) : body
  }
  if (schema && typeof schema.parse === 'function') {
    // zod: the ZodError propagates as-is (with .issues) so callers keep
    // the full API; the validation marker keeps it out of the circuit
    // breaker's failure count.
    try {
      return ensureSync(schema.parse(body))
    } catch (err) {
      err.validation = true
      throw err
    }
  }
  if (schema && typeof schema.safeParse === 'function') {
    // valibot
    const result = ensureSync(schema.safeParse(body))
    if (result && result.success === false) {
      const issues = result.issues || []
      const message = issues.length
        ? issues.map(function (issue) {
          const path = issue.path && issue.path.length ? issue.path.join('.') + ': ' : ''
          return path + (issue.message || 'invalid')
        }).join('; ')
        : 'invalid value'
      const err = new Error('Response failed schema validation: ' + message)
      err.validation = true
      throw err
    }
    return result ? ensureSync(result.output) : body
  }
  return body
}

module.exports = { validateWithSchema }
