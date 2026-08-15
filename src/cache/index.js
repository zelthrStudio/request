'use strict'

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

// RFC 7234 HTTP cache: `cache: true` uses the shared defaultCache; pass an
// HttpCache instance or `{ ttl, maxEntries }` for a dedicated store.

const { HttpCache, defaultCache } = require('./http-cache')

exports.HttpCache = HttpCache
exports.defaultCache = defaultCache
