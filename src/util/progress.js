'use strict'

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

// Progress events: emitted on the request while the body is uploaded or the
// response is downloaded. `throughput` is the download rate relative to the
// request start (bytes/second), so it is comparable across requests of
// different sizes.
function emitProgress (self, phase) {
  const p = self._progress
  const now = performance.now()
  const elapsed = now - (p.start || now)
  const throughput = elapsed > 0 ? (p.received / elapsed) * 1000 : 0
  self.emit('progress', {
    phase,
    uploaded: p.uploaded,
    uploadedTotal: p.uploadedTotal,
    uploadPercent: p.uploadedTotal ? (p.uploaded / p.uploadedTotal) * 100 : 0,
    downloaded: p.received,
    downloadedTotal: p.total,
    percent: p.total ? (p.received / p.total) * 100 : 0,
    throughput
  })
}

module.exports = { emitProgress }
