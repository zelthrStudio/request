'use strict'

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
    const result = ensureSync(schema.validate(body))
    if (result && result.error) {
      const err = new Error('Response failed schema validation: ' + result.error.message)
      err.validation = true
      throw err
    }
    return result ? ensureSync(result.value) : body
  }
  if (schema && typeof schema.parse === 'function') {
    try {
      return ensureSync(schema.parse(body))
    } catch (err) {
      err.validation = true
      throw err
    }
  }
  if (schema && typeof schema.safeParse === 'function') {
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
