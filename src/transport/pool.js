'use strict'

const http = require('http')
const https = require('https')
const { connectOptions, connectSignature, stableValue } = require('./tls')
const { closeSessions } = require('./http2')

let defaultAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 1000 })
const httpsAgents = new Map()
const httpAgents = new Map()
const proxyAgents = new Map()
const customAgents = new Map()

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
    map.delete(key)
    map.set(key, value)
  }
  return value
}

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
  if (self.agent) {
    return self.agent
  }

  if (self.pool === false) {
    const Agent = self.uri.protocol === 'https:' ? https.Agent : http.Agent
    const agent = new Agent({ keepAlive: false })
    self._disposableAgent = agent
    return agent
  }

  const isHttps = self.uri.protocol === 'https:'
  const connect = connectOptions(self)
  const signature = connectSignature(self, connect)

  const poolOptions = customPoolOptions(self)
  if (Object.keys(poolOptions).length > 0) {
    const key = stableValue(poolOptions) + '&' + signature
    let agent = lruGet(customAgents, key)
    if (!agent) {
      const Agent = isHttps ? https.Agent : http.Agent
      agent = new Agent(Object.assign({ keepAlive: true, keepAliveMsecs: 1000 }, poolOptions, connect))
      lruSet(customAgents, key, agent, MAX_CUSTOM_AGENTS)
    }
    return agent
  }

  if (self.proxy && !isHttps) {
    const key = self.proxy.href + '|' + signature
    let agent = lruGet(proxyAgents, key)
    if (!agent) {
      const ProxyAgent = self.proxy.protocol === 'https:' ? https.Agent : http.Agent
      agent = new ProxyAgent(Object.assign({ keepAlive: true, keepAliveMsecs: 1000 }, connect))
      lruSet(proxyAgents, key, agent, MAX_PROXY_AGENTS)
    }
    return agent
  }

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
