'use strict'

// Modified by zelthrStudio (2026) from the original `request` package
// (Copyright 2010-2012 Mikeal Rogers, Apache License 2.0).

// All timings will be relative to this request's startTime.
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

// Fill in the blanks for any periods that didn't trigger, such as no lookup
// or connect due to keep-alive, and expose the timings on the response.
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

  // elapsedTime includes all redirects.
  self.elapsedTime += Math.round(self.timings.end)

  // NOTE: elapsedTime is deprecated in favor of .timings.
  self.response.elapsedTime = self.elapsedTime
  self.response.timingStart = self.startTime
  const download = self.timings.end - self.timings.response
  // Throughput (relative): bytes received divided by the download phase
  // duration, in bytes/second. The byte counter is always tracked, so this
  // works without the `progress` option.
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
