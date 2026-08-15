# @zelthr/request

Simplified HTTP request client for Node.js — a modern remake of the classic
[`request`](https://github.com/request/request) package, with HTTP/2,
keep-alive pooling and modern streaming built in while keeping the classic
`request` API.

- Same familiar API: `request(url, callback)`, convenience verbs, `defaults`,
  `jar`, `forever`, streaming.
- Native promises: the `Request` returned by any call is a thenable, so
  `await request(url)` just works — no wrapper library needed. An explicit
  `request.promise()` helper is included too.
- HTTP/1.1 and HTTP/2, redirects, cookies, gzip, basic/bearer/digest auth,
  `multipart/form-data` and `application/x-www-form-urlencoded` bodies,
  HTTP proxies and HTTPS CONNECT tunneling — all out of the box.
- Got-style extras: `hooks`, built-in retry with backoff, `AbortController`
  cancellation, configurable connection pooling, modern streaming and a
  `paginate()` async generator.
- TypeScript types included. Plain JavaScript (CommonJS + ESM), zero build
  step, **zero runtime dependencies** — built directly on Node's
  `http`/`https`/`http2`. Requires Node.js >= 18.

> **Attribution**: This project is a fork/remake of
> [`request`](https://github.com/request/request) by Mikeal Rogers, licensed
> under the [Apache License 2.0](LICENSE). Modified by zelthrStudio (2026). See
> [NOTICE](NOTICE) for the attribution notices.

## Install

```sh
npm install @zelthr/request
```

## Super simple to use

```js
const request = require('@zelthr/request')

request('http://www.google.com', function (error, response, body) {
  console.error('error:', error)
  console.log('statusCode:', response && response.statusCode)
  console.log('body:', body)
})
```

## Table of contents

- [Request options](#request-options)
- [Convenience methods](#convenience-methods)
- [request.defaults()](#requestdefaultsoptions)
- [Promises](#promises)
- [Hooks](#hooks)
- [Retry](#retry)
- [Pagination](#pagination)
- [Cookies](#cookies)
- [Streaming](#streaming)
- [HTTP/2](#http2)
- [Forms](#forms)
- [JSON](#json)
- [Authentication](#authentication)
- [Proxies](#proxies)
- [Timeouts and errors](#timeouts-and-errors)
- [TLS](#tls)
- [Connection pooling](#connection-pooling)
- [Timings](#timings)
- [TypeScript / ESM](#typescript--esm)
- [API reference](#api-reference)

## Request options

Options are passed either as an object or as a URL string:

```js
request({
  uri: 'http://api.github.com/user',
  method: 'GET',
  headers: { 'User-Agent': 'zelthr/request' }
}, callback)
```

| Option | Description |
| --- | --- |
| `uri` / `url` | Fully qualified URI or parsed URL object. |
| `method` | HTTP method, default `GET`. |
| `qs` | Object of query-string values added to the URI. |
| `headers` | HTTP request headers. |
| `body` | Request body: string, `Buffer`, array, Node `Readable`, web `ReadableStream`, or async iterable. |
| `json` | `true` to send/parse JSON, or an object/string to serialize. |
| `form` | Object/string encoded as `application/x-www-form-urlencoded`. |
| `multipart` | Array of multipart parts (see [Forms](#forms)). |
| `auth` | `{ user, pass, sendImmediately, bearer }` for basic/bearer auth. |
| `followRedirect` | Follow redirects, default `true`. |
| `followAllRedirects` | Follow non-GET redirects too, default `false`. |
| `maxRedirects` | Maximum number of redirects, default `10`. |
| `gzip` | `true` to request and transparently decode gzip/deflate responses. |
| `brotli` | `true` (with `gzip`) to also advertise and decode Brotli (`br`) responses. |
| `cache` | RFC 7234 HTTP cache: `true` (shared store), an `HttpCache` instance, or `{ ttl, maxEntries }`. See [Caching](#caching). |
| `dnsCache` | DNS result cache: `true` (shared), `{ ttl, max }`, or a custom `lookup` function. |
| `lookup` | Custom DNS lookup function passed to the transport. |
| `progress` | `true` to emit `progress` events while uploading/downloading. |
| `mock` | Mock this request: a `{ statusCode, headers, body }` spec or a function returning one (or `null` to pass through). |
| `timeout` | Timeout in milliseconds (headers + body idle). |
| `jar` | Cookie jar (from `request.jar()`) to persist cookies across requests. |
| `proxy` | Proxy URL; also read from `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` env vars. |
| `tunnel` | Accepted for compatibility (tunneling is automatic). |
| `pool` | `false` to open a new connection per request. |
| `agent` | Custom `http.Agent`/`https.Agent` (or any Node agent) for connection pooling. |
| `forever` | Use keep-alive agents (`true` or `{}` for agent options). |
| `time` | `true` to record timings on the response. |
| `retry` | `true`, a number, or a [retry config](#retry) to retry failed requests. |
| `hooks` | `{ beforeRequest, afterResponse }` [hooks](#hooks). |
| `paginate` | `{ transform, filter, ... }` options for [paginate()](#pagination). |
| `rejectUnauthorized` | TLS: verify the server certificate, default `true`. |
| `ca` | TLS: override the trusted CA certificates. |
| `checkServerIdentity` | TLS: custom hostname verification function. |
| `http2` | `true` to use HTTP/2 (h2 for `https:`, h2c for `http:`). |
| `localAddress` | Bind to a specific local interface. |
| `strictSSL` | Alias of `rejectUnauthorized`. |
| `encoding` | Response body encoding (`'utf8'`, `null` for a `Buffer`, ...). |
| `qsStringifyOptions` / `qsParseOptions` | Options forwarded to the built-in query-string encoder. |

## Convenience methods

```js
request.get(url, callback)
request.post(url, callback)
request.put(url, callback)
request.patch(url, callback)
request.head(url, callback)
request.del(url, callback)   // also request.delete
request.options(url, callback)
```

## request.defaults(options)

Returns a wrapper with default options applied to every request:

```js
const client = request.defaults({
  baseUrl: 'https://api.example.com',
  headers: { Authorization: 'Bearer token' }
})

client('/users', callback)
```

## Caching

The `cache` option enables an RFC 7234 HTTP cache (in-process, in-memory).
GET responses are stored when cacheable and served without touching the
network while fresh; stale entries are revalidated with `If-None-Match` /
`If-Modified-Since` and refreshed on a `304`:

```js
// Shared store (usable across requests, even without `cache: true`):
const response = await request.promise({ uri: url, cache: true })
response.fromCache    // true when served from the cache
response.revalidated  // true when refreshed by a 304

request.cache.clear() // empty the shared store
```

`cache: true` uses the shared store exposed as `request.cache`; pass
`{ ttl, maxEntries }` or your own `HttpCache` instance for a dedicated
store. `Vary` headers are honored, and responses with `no-store`,
Authorization requests without `public`, or non-GET methods are never
stored.

## Mocking

The mocking layer intercepts requests before they hit the network:

```js
request.mock.add('/users', (uri, req) => ({
  statusCode: 200,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify([{ id: 1 }])
}))

const response = await request.promise('http://api.example.com/users')
response.isMock // true

request.mock.clear()   // remove all mocks
request.mock.disable() // bypass mocks until enable()
```

Matchers can be a URL substring, a `RegExp`, or a `(uri, request) => boolean`
function. Handlers may be async and return `null` to pass through to the
network. A per-request `mock` option does the same for a single request.

## Promises

Every `request(...)` call returns a `Request` stream that is also a thenable,
so it can be awaited natively — no wrapper package or extra API required:

```js
async function main () {
  const response = await request('http://www.google.com')
  console.log('statusCode:', response.statusCode)
  console.log('body:', response.body)

  const json = await request.post({
    uri: 'https://example.com/api',
    json: { hello: 'world' }
  })
  console.log(json.body) // response.body is already parsed with json: true
}

main().catch(console.error)
```

The promise resolves with the full response object (with `.body` populated)
once the response is complete, and rejects on request errors and aborts:

```js
const response = await request(url)
  .then((res) => res.body)      // chain like any promise
  .catch((err) => {             // network errors, timeouts, aborts
    console.error(err.code)
    return null
  })
  .finally(() => console.log('done'))
```

An explicit helper reads even better in TypeScript:

```js
const response = await request.promise(url, { json: true })
```

The callback, event and streaming APIs are unchanged and can be mixed freely:
`request(url).pipe(fs.createWriteStream(...))` and `await request(url)` work
on the same request object.

## Hooks

Got-style lifecycle hooks:

- `beforeRequest` — called with the `Request` before each attempt (including
  every retry). May mutate the request; throwing aborts the request.
- `afterResponse` — called with the final response. May return a replacement
  response (`{ statusCode, headers, body }`) or throw. Redirect responses
  are skipped.

```js
request({
  uri: 'https://api.example.com/data',
  hooks: {
    beforeRequest: [
      function (req) {
        req.setHeader('x-trace', crypto.randomUUID())
      }
    ],
    afterResponse: [
      function (response) {
        if (response.statusCode === 404) {
          return { statusCode: 404, body: '{}' } // normalize missing data
        }
        return undefined // keep the original response
      }
    ]
  }
}, callback)
```

Each option accepts a single function or an array of functions; async
functions are awaited in order.

## Retry

Retries are opt-in (`retry: false` by default) and only happen when the
request body is replayable (string/Buffer/array — or no body at all), so
streamed uploads are never re-sent.

```js
request({
  uri: 'https://api.example.com/items',
  retry: true,                       // sensible defaults
  // retry: 3                        // just the limit
  // retry: {                        // full control
  //   limit: 5,
  //   statusCodes: [429, 503],
  //   errorCodes: ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'],
  //   maxRetryAfter: 30000,         // cap for Retry-After
  //   backoff: 1000,                // base ms, exponential (or a function)
  //   jitter: true
  // }
}, callback)
```

Defaults: `limit: 3`, methods `GET/HEAD/OPTIONS/PUT/DELETE`, status codes
`429` and `503`, network error codes, exponential backoff from 1000 ms.
A `Retry-After` response header is honored (capped by `maxRetryAfter`).

## Pagination

`request.paginate(uri, options)` is an async generator that follows pages
until they run out. By default the next URL comes from a `Link: rel="next"`
header, falling back to a `next` field on a JSON body.

```js
for await (const item of request.paginate('https://api.example.com/users', {
  json: true,
  paginate: {
    transform: (response) => response.body.data,
    filter: (item) => item.active,
    countLimit: 100,
    requestLimit: 20,
    backoff: 200
  }
})) {
  console.log(item.name)
}
```

Pagination options: `transform` (map a response to items), `filter`,
`shouldContinue` (stop early), `nextUrl` (custom page resolver),
`countLimit`, `requestLimit` and `backoff` (delay between pages).

## Cookies

```js
const jar = request.jar()
request({ uri: 'https://example.com/login', jar }, function (err, res) {
  request({ uri: 'https://example.com/account', jar }, function (err, res, body) {
    console.log(body)
  })
})
```

A global `request.cookie(str)` helper parses cookie strings, and
`request.jar()` creates an isolated jar. Any `CookieJar`-compatible object (a
`setCookie`/`getCookieString` pair) can be passed as `jar`.

## Streaming

Any request is a readable stream of the response body:

```js
request('https://example.com/big-file.mp4').pipe(fs.createWriteStream('out.mp4'))
```

And any writable stream can be used as the request body:

```js
fs.createReadStream('in.txt').pipe(request.post('https://example.com/upload'))
```

Web streams and async iterables work as `body` too:

```js
const response = await request.promise({
  uri: 'https://example.com/upload',
  method: 'POST',
  body: new Blob(['hello']).stream()
})
```

`request(...).pipe(dest)` also copies the response headers onto `dest` when it
is a `http.ServerResponse`, so it can act as a pass-through proxy.

## HTTP/2

Pass `http2: true` to send the request over HTTP/2:

```js
const response = await request({
  uri: 'https://example.com/api',
  http2: true,
  json: true
})
console.log(response.body)
```

- `https:` URLs negotiate HTTP/2 via ALPN (`h2`); `http:` URLs use cleartext
  HTTP/2 (h2c, prior knowledge).
- Connections are pooled and multiplexed — no `Agent` or `forever` options
  needed.
- TLS options (`ca`, `rejectUnauthorized`, `cert`, `key`, ...) work as usual,
  and redirects, gzip, cookies, JSON bodies, forms and promises all behave
  the same as over HTTP/1.
- Not supported together with `proxy` (an error is emitted if both are set).

HTTP/1.1 remains the default; `http2` must be enabled per request (or baked
into a `request.defaults({ http2: true })` wrapper).

## Forms

`application/x-www-form-urlencoded`:

```js
request.post('https://example.com/login', { form: { user: 'bob', pass: 'secret' } }, callback)
```

`multipart/form-data`:

```js
request.post('https://example.com/upload', {
  multipart: [
    { 'content-type': 'application/json', body: JSON.stringify({ hello: 'world' }) },
    { 'content-type': 'text/plain', body: 'plain text', 'content-length': 10 }
  ]
}, callback)
```

Or use `request.post(...).form()` for a `form-data`-style instance (with the
`append`/`getHeaders`/`getLength`/`pipe` API, built in — no dependency):

```js
const form = request.post('https://example.com/upload').form()
form.append('file', fs.createReadStream('photo.png'))
```

## JSON

```js
request.post('https://example.com/api', { json: { hello: 'world' } }, function (err, res, body) {
  console.log(body.hello) // body is already parsed
})
```

## Authentication

Basic and bearer auth are sent immediately by default:

```js
request.get({ uri: 'https://example.com/private', auth: { user: 'bob', pass: 'secret' } }, callback)
request.get({ uri: 'https://example.com/private', auth: { bearer: 'token' } }, callback)
```

Basic auth in the URL is supported too (`https://user:pass@example.com/`).

Digest auth is used when the server responds with a `401` and a
`WWW-Authenticate: Digest` challenge.

## Proxies

```js
request({ uri: 'http://example.com/', proxy: 'http://user:pass@proxy.local:8080' }, callback)
```

When no `proxy` option is given, the `HTTP_PROXY`, `HTTPS_PROXY` and
`NO_PROXY` environment variables are consulted. HTTPS requests tunnel
through the proxy with a CONNECT request automatically; HTTP requests are
sent in absolute-form. Proxy credentials come from the proxy URL
(`http://user:pass@proxy:8080`).

## Timeouts and errors

```js
request({ uri: 'http://example.com/', timeout: 5000 }, function (err, res, body) {
  if (err) {
    console.error(err.code) // 'ETIMEDOUT', 'ECONNREFUSED', ...
  }
})
```

A timeout before the response arrives surfaces as `ETIMEDOUT` with
`err.connect === true`; a timeout while the response is being read maps to
`ESOCKETTIMEDOUT`. Errors are delivered to the callback and emitted on the
request object.

## TLS

```js
request({
  uri: 'https://self-signed.local/',
  ca: fs.readFileSync('ca.crt'),
  checkServerIdentity: function () { return undefined }
}, callback)
```

`rejectUnauthorized: false` disables certificate verification. Custom
`ca`, `cert`, `key`, `pfx`, `passphrase`, `ciphers` and `secureProtocol`
options are supported.

## Connection pooling

Requests share a keep-alive pool by default:

- `pool: false` — a fresh connection per request (closed when done).
- `agent` — plug in a custom `http.Agent`/`https.Agent` to take full control
  over pooling and connection limits.
- Requests with custom TLS settings automatically use a pool keyed by those
  settings, so `ca`/`rejectUnauthorized`/client certificates don't leak
  between requests.
- `request.closePool()` closes all pooled connections — handy to let a
  process exit promptly in tests or long-running CLI tools.

```js
const client = request.defaults({ agent: new http.Agent({ keepAlive: true }) })
const response = await client.promise('https://example.com/')
```

## Timings

```js
request({ uri: 'http://example.com/', time: true }, function (err, response) {
  console.log(response.timings)       // { wait, dns, tcp, firstByte, download, total }
  console.log(response.timingStart)
})
```

## TypeScript

Types are bundled (`"types"` field) for both CommonJS and ESM consumers — no
`@types` package needed:

```ts
// CommonJS
import request = require('@zelthr/request')

// ESM / NodeNext
import request from '@zelthr/request'
import { get, promise, paginate } from '@zelthr/request'
import type { CoreOptions, Response, RetryOptions } from '@zelthr/request'

const response = await promise('https://example.com/api', { json: true })
const status: number = response.statusCode

const client = request.defaults({ baseUrl: 'https://api.example.com' })
for await (const item of client.paginate('/users', { json: true })) {
  // item: any
}
```

## ESM / CommonJS

The package ships dual: `require('@zelthr/request')` and
`import request from '@zelthr/request'` both work, with named exports
(`get`, `post`, `del`, `promise`, `paginate`, ...) available to ESM
importers.

## API reference

- `request(options, [callback])` — returns the `Request` stream, which is
  thenable and can be awaited (see [Promises](#promises)).
- `request(uri, [callback])` — shorthand.
- `request.defaults(options)` — preconfigured wrapper.
- `request.get/post/put/patch/head/del/delete/options(...)` — verb helpers.
- `request.promise(uri, options)` — returns a `Promise<Response>`.
- `request.paginate(uri, options)` — async generator over paginated results.
- `request.jar([store])` — a cookie jar.
- `request.cookie(str)` — parse a cookie string.
- `request.forever([agentOptions])` — wrapper using keep-alive agents.
- `request.closePool()` — close all pooled connections.
- `request.cache` — the shared RFC 7234 HTTP cache (`clear()`, `size`).
- `request.mock` — the global mocking layer (`add`, `clear`, `enable`, `disable`).

## Running the tests

```sh
npm test          # node --test "tests/test-*.js" "tests/test-*.mjs"
npm run lint      # standard
npm run typecheck # tsc --noEmit
```

## License

Apache-2.0