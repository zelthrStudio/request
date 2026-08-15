'use strict'

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

const http = require('http')
const https = require('https')
const { connectOptions, connectSignature } = require('./tls')
const { closeSessions } = require('./http2')

// Connection pooling with Node's http/https agents.
// - Requests share a keep-alive pool by default.
// - Agents with custom TLS settings (ca, rejectUnauthorized, client certs)
//   are pooled per unique connect-options signature so those settings never
//   leak between requests.
// - pool: false opens a fresh connection per request (a disposable agent).
// - agent: accepts a user-provided http.Agent / https.Agent.
// - closePool() destroys every pooled agent and HTTP/2 session so the
//   process can exit promptly.

let defaultAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 1000 })
const httpsAgents = new Map()
const httpAgents = new Map()
const proxyAgents = new Map()
// Agents created from `pool: {...}`, `agentOptions` and `forever: {...}`.
const customAgents = new Map()

// Cap the per-signature agent maps: a per-tenant CA/client-cert pattern or
// per-request `pool` options would otherwise grow agents (and their
// keep-alive sockets) without bound. Evicted agents are destroyed so their
// sockets (and fds) do not accumulate on a long-running process.
const MAX_HTTPS_AGENTS = 100
const MAX_HTTP_AGENTS = 50
const MAX_PROXY_AGENTS = 50
const MAX_CUSTOM_AGENTS = 50

function lruSet (map, key, value, max) {
  map.delete(key)
  map.set(key, value)
  while (map.size > max) {
    const evictedKey = map.keys().next().value
    const evicted = map.get(evictedKey)
    map.delete(evictedKey)
    destroyEvictedAgent(evicted)
  }
}

// Destroy an agent that just lost its place in the pool. Only agents with no
// in-flight requests are destroyed: `agent.destroy()` also closes sockets
// currently in use, which would cut off live requests. Busy agents are
// deferred — their sockets close when the in-flight requests finish and the
// keep-alive timer fires. Destroyed idle agents stop accepting sockets and
// close their keep-alive sockets immediately.
function destroyEvictedAgent (agent) {
  if (!agent || typeof agent.destroy !== 'function') {
    return
  }
  const inFlight = agent.sockets
  const busy = inFlight && (typeof inFlight.size === 'number' ? inFlight.size > 0 : Object.keys(inFlight).length > 0)
  if (!busy) {
    agent.destroy()
  }
}

function lruGet (map, key) {
  const value = map.get(key)
  if (value !== undefined) {
    // delete+set refreshes insertion order so the most recently used agent
    // is not the first candidate for eviction.
    map.delete(key)
    map.set(key, value)
  }
  return value
}

// Explicit `pool`/`agentOptions`/`forever` settings (maxSockets, timeouts,
// scheduling, ...) previously documented but silently ignored. Honor them
// through a dedicated agent, cached per unique settings object.
function customPoolOptions (self) {
  const options = {}
  const sources = [self.pool, self.agentOptions, self.forever]
  for (const source of sources) {
    if (source && typeof source === 'object' && !(source instanceof http.Agent) && !(source instanceof https.Agent)) {
      for (const key of Object.keys(source)) {
        if (options[key] === undefined) {
          options[key] = source[key]
        }
      }
    }
  }
  return options
}

function getAgent (self) {
  // 1. An explicit agent wins.
  if (self.agent) {
    return self.agent
  }

  // 2. pool: false -> a per-request agent, destroyed once the request is done.
  if (self.pool === false) {
    const Agent = self.uri.protocol === 'https:' ? https.Agent : http.Agent
    const agent = new Agent({ keepAlive: false })
    self._disposableAgent = agent
    return agent
  }

  const isHttps = self.uri.protocol === 'https:'
  const connect = connectOptions(self)
  // The signature covers every socket-affecting option (TLS settings,
  // localAddress, family and the `lookup` function), so a custom DNS
  // resolver can never be silently bypassed by reusing a socket pooled by a
  // request without it.
  const signature = connectSignature(self, connect)

  // 3. Explicit pool settings (maxSockets, agentOptions, forever): a
  // dedicated agent per unique settings + connect signature.
  const poolOptions = customPoolOptions(self)
  if (Object.keys(poolOptions).length > 0) {
    const key = JSON.stringify(poolOptions) + '&' + signature
    let agent = lruGet(customAgents, key)
    if (!agent) {
      const Agent = isHttps ? https.Agent : http.Agent
      agent = new Agent(Object.assign({ keepAlive: true, keepAliveMsecs: 1000 }, poolOptions, connect))
      lruSet(customAgents, key, agent, MAX_CUSTOM_AGENTS)
    }
    return agent
  }

  // 4. HTTP through a proxy: pool the connection to the proxy itself.
  if (self.proxy && !isHttps) {
    const key = self.proxy.href + '|' + signature
    let agent = lruGet(proxyAgents, key)
    if (!agent) {
      agent = new http.Agent(Object.assign({ keepAlive: true, keepAliveMsecs: 1000 }, connect))
      lruSet(proxyAgents, key, agent, MAX_PROXY_AGENTS)
    }
    return agent
  }

  // 5. Plain http: the shared keep-alive agent unless socket-affecting
  // options (localAddress, family, lookup) require a dedicated pool.
  if (!isHttps) {
    if (signature === '') {
      return defaultAgent
    }
    let agent = lruGet(httpAgents, signature)
    if (!agent) {
      agent = new http.Agent(Object.assign({ keepAlive: true, keepAliveMsecs: 1000 }, connect))
      lruSet(httpAgents, signature, agent, MAX_HTTP_AGENTS)
    }
    return agent
  }

  // 6. https: an agent per TLS/connect signature ('' for default TLS).
  let agent = lruGet(httpsAgents, signature)
  if (!agent) {
    const options = { keepAlive: true, keepAliveMsecs: 1000 }
    for (const key of Object.keys(connect)) {
      options[key] = connect[key]
    }
    agent = new https.Agent(options)
    lruSet(httpsAgents, signature, agent, MAX_HTTPS_AGENTS)
  }
  return agent
}

function closeDisposableAgent (self, destroy) {
  const agent = self._disposableAgent
  if (!agent) {
    return
  }
  self._disposableAgent = null
  if (destroy) {
    agent.destroy()
  }
}

function closePool () {
  defaultAgent.destroy()
  for (const map of [httpsAgents, httpAgents, proxyAgents, customAgents]) {
    for (const agent of map.values()) {
      agent.destroy()
    }
    map.clear()
  }
  closeSessions()
  defaultAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 1000 })
}

module.exports = { getAgent, closeDisposableAgent, closePool }
