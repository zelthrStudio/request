'use strict'

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

// Response schema validation for the `schema` option. Duck-typing keeps
// the validation libraries as optional peer dependencies (no runtime
// deps): joi exposes .validate(), zod throws from .parse(), valibot
// returns a result object from .safeParse(). A plain function is
// supported too. The validated (possibly transformed) value replaces the
// parsed body.

function validateWithSchema (schema, body) {
  if (typeof schema === 'function') {
    return schema(body)
  }
  if (schema && typeof schema.validate === 'function') {
    // joi
    const result = schema.validate(body)
    if (result && result.error) {
      const err = new Error('Response failed schema validation: ' + result.error.message)
      err.validation = true
      throw err
    }
    return result ? result.value : body
  }
  if (schema && typeof schema.parse === 'function') {
    // zod: the ZodError propagates as-is so callers keep the .issues API.
    return schema.parse(body)
  }
  if (schema && typeof schema.safeParse === 'function') {
    // valibot
    const result = schema.safeParse(body)
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
    return result ? result.output : body
  }
  return body
}

module.exports = { validateWithSchema }
