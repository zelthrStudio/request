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
const proxyAgents = new Map()

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
  const signature = connectSignature(self, connect)

  // 3. HTTP through a proxy: pool the connection to the proxy itself.
  if (self.proxy && !isHttps) {
    const key = self.proxy.href
    let agent = proxyAgents.get(key)
    if (!agent) {
      agent = new http.Agent({ keepAlive: true, keepAliveMsecs: 1000 })
      proxyAgents.set(key, agent)
    }
    return agent
  }

  // 4. Plain http: the shared keep-alive agent.
  if (!isHttps) {
    return defaultAgent
  }

  // 5. https: an agent per TLS signature ('' for default TLS).
  let agent = httpsAgents.get(signature)
  if (!agent) {
    const options = { keepAlive: true, keepAliveMsecs: 1000 }
    for (const key of Object.keys(connect)) {
      options[key] = connect[key]
    }
    agent = new https.Agent(options)
    httpsAgents.set(signature, agent)
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
  for (const agent of httpsAgents.values()) {
    agent.destroy()
  }
  for (const agent of proxyAgents.values()) {
    agent.destroy()
  }
  httpsAgents.clear()
  proxyAgents.clear()
  closeSessions()
  defaultAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 1000 })
}

module.exports = { getAgent, closeDisposableAgent, closePool }
