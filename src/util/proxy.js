'use strict'

// Modified by zelthrStudio (2026) from the original `request` package
// (Copyright 2010-2012 Mikeal Rogers, Apache License 2.0).

function formatHostname (hostname) {
  // Canonicalize the hostname, so that 'oogle.com' won't match 'google.com'.
  return hostname.replace(/^\.*/, '.').toLowerCase()
}

function parseNoProxyZone (zone) {
  zone = zone.trim().toLowerCase()

  const zoneParts = zone.split(':', 2)
  const zoneHost = formatHostname(zoneParts[0])
  const zonePort = zoneParts[1]
  const hasPort = zone.indexOf(':') > -1

  return { hostname: zoneHost, port: zonePort, hasPort }
}

function uriInNoProxy (uri, noProxy) {
  const port = uri.port || (uri.protocol === 'https:' ? '443' : '80')
  const hostname = formatHostname(uri.hostname)
  const noProxyList = noProxy.split(',')

  // Iterate through the noProxyList until it finds a match.
  return noProxyList.map(parseNoProxyZone).some(function (noProxyZone) {
    const isMatchedAt = hostname.indexOf(noProxyZone.hostname)
    const hostnameMatched = (
      isMatchedAt > -1 &&
      (isMatchedAt === hostname.length - noProxyZone.hostname.length)
    )

    if (noProxyZone.hasPort) {
      return (port === noProxyZone.port) && hostnameMatched
    }

    return hostnameMatched
  })
}

function getProxyFromURI (uri) {
  // Decide the proper request proxy to use based on the request URI object and
  // the environmental variables (NO_PROXY, HTTP_PROXY, etc.).
  const noProxy = process.env.NO_PROXY || process.env.no_proxy || ''

  if (noProxy === '*') {
    return null
  }

  if (noProxy !== '' && uriInNoProxy(uri, noProxy)) {
    return null
  }

  if (uri.protocol === 'http:') {
    return process.env.HTTP_PROXY ||
      process.env.http_proxy || null
  }

  if (uri.protocol === 'https:') {
    return process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy || null
  }

  return null
}

module.exports = getProxyFromURI
