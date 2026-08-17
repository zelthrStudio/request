'use strict'

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
