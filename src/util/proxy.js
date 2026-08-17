'use strict'

function formatHostname (hostname) {
  return hostname.replace(/^\.*/, '').toLowerCase()
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

  return noProxyList.map(parseNoProxyZone).some(function (noProxyZone) {
    let zoneHost = noProxyZone.hostname
    const wildcard = zoneHost.slice(0, 2) === '*.'
    if (wildcard) {
      zoneHost = zoneHost.slice(2)
    }
    const hostnameMatched = (
      zoneHost !== '' &&
      (hostname === zoneHost || hostname.endsWith('.' + zoneHost)) &&
      (wildcard ? hostname !== zoneHost : true)
    )

    if (noProxyZone.hasPort) {
      return (port === noProxyZone.port) && hostnameMatched
    }

    return hostnameMatched
  })
}

function getProxyFromURI (uri) {
  const noProxy = process.env.NO_PROXY || process.env.no_proxy || ''

  if (noProxy === '*') {
    return null
  }

  if (noProxy !== '' && uriInNoProxy(uri, noProxy)) {
    return null
  }

  const cgi = process.env.REQUEST_METHOD !== undefined

  if (uri.protocol === 'http:') {
    return process.env.HTTP_PROXY ||
      (cgi ? null : process.env.http_proxy) || null
  }

  if (uri.protocol === 'https:') {
    return process.env.HTTPS_PROXY ||
      (cgi ? null : process.env.https_proxy) ||
      process.env.HTTP_PROXY ||
      (cgi ? null : process.env.http_proxy) || null
  }

  return null
}

module.exports = getProxyFromURI
