'use strict'

function initTimings (self) {
  self.startTime = new Date().getTime()
  self.startTimeNow = performance.now()
  self.timings = {}
}

function recordSocketTiming (self, socket) {
  self.timings.socket = performance.now() - self.startTimeNow
  if (socket.connecting) {
    socket.once('lookup', function () {
      self.timings.lookup = performance.now() - self.startTimeNow
    })
    socket.once('connect', function () {
      self.timings.connect = performance.now() - self.startTimeNow
    })
  }
}

function finalizeTimings (self) {
  self.timings.end = performance.now() - self.startTimeNow

  if (!self.timings.socket) {
    self.timings.socket = 0
  }
  if (!self.timings.lookup) {
    self.timings.lookup = self.timings.socket
  }
  if (!self.timings.connect) {
    self.timings.connect = self.timings.lookup
  }
  if (!self.timings.response) {
    self.timings.response = self.timings.connect
  }

  self.debug('elapsed time', self.timings.end)

  self.elapsedTime += Math.round(self.timings.end)

  self.response.elapsedTime = self.elapsedTime
  self.response.timingStart = self.startTime
  const download = self.timings.end - self.timings.response
  const received = (self._progress && self._progress.received) || 0
  self.response.timings = {
    wait: self.timings.socket,
    dns: self.timings.lookup - self.timings.socket,
    tcp: self.timings.connect - self.timings.lookup,
    firstByte: self.timings.response - self.timings.connect,
    download,
    total: self.timings.end,
    downloadBytes: received,
    throughput: download > 0 ? (received / download) * 1000 : 0
  }
  self.response.timingPhases = self.response.timings
}

module.exports = { initTimings, recordSocketTiming, finalizeTimings }
