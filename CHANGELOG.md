# Change Log

## [Unreleased] — caching, DNS, brotli, progress, mocking & throughput

### Added

- **RFC 7234 HTTP cache** via the `cache` option: `cache: true` uses the
  shared store, or pass an `HttpCache` instance / `{ ttl, maxEntries }` for a
  dedicated one. GET responses are stored when cacheable (status, no-store,
  Authorization rules, `Vary` honored per header variant) and served without
  touching the network while fresh; stale entries are revalidated with
  `If-None-Match` / `If-Modified-Since` and refreshed on a 304. Cached
  responses expose `response.fromCache` and `response.revalidated`;
  `request.cache` exposes the shared store with `clear()` / `size`.
- **DNS cache** via the `dnsCache` option: `dnsCache: true` shares a
  process-wide cache (TTL 30s, 1000 entries by default), or pass
  `{ ttl, max }` / a custom lookup function. A `lookup` option is also passed
  straight through to the transport.
- **Brotli decompression** via `brotli: true` (in addition to `gzip: true`):
  advertises `Accept-Encoding: gzip, deflate, br` and decodes `br` responses.
- **Progress events** via `progress: true`: the request emits `progress`
  events while the body is uploaded and the response downloaded, carrying
  `{ phase, uploaded, uploadedTotal, uploadPercent, downloaded,
  downloadedTotal, percent, throughput }`.
- **Mocking layer**: global mocks via `request.mock.add(matcher, handler)`
  (string/RegExp/function matcher, sync or async handlers returning a
  `{ statusCode, headers, body }` spec or null to pass through), plus a
  per-request `mock` option (static spec or function). Mocked responses
  expose `response.isMock`.
- **Throughput (relative)** in timings: `response.timings.downloadBytes` and
  `response.timings.throughput` (bytes/second over the download phase) are
  always reported with `time: true`, and `progress` events carry a live
  throughput relative to the request start.

### Changed

- Response byte counters are always tracked (used by throughput timing), so
  the overhead is a single increment per chunk when no `progress` listener
  is attached.

## [Unreleased] — hardening & performance

### Fixed

- **Security: the cookie jar now validates the `Domain` attribute** before
  storing a cookie. A `Set-Cookie` whose `Domain` does not domain-match the
  request host (or is a bare single-label TLD such as `Domain=com`) is
  rejected, so a malicious server can no longer poison the shared jar with
  cookies scoped to another host.

### Changed

- Reserved-option validation (`__proto__`/`constructor` key checks) now uses a
  cached property-name `Set` instead of re-deriving prototype names per
  request, removing the per-request allocation in the hot path.

## [Unreleased] — security hardening

### Fixed

- **Security: prototype pollution in the query-string parser** (`qs.parse`).
  Keys whose bracket path touches `__proto__`, `constructor` or `prototype`
  (at any nesting depth, including percent-encoded forms) are now skipped,
  so untrusted query strings can no longer mutate `Object.prototype`.
- **Security: redirects no longer leak the previous URL cross-host.** The
  `Referer` header is only forwarded when the redirect target keeps the same
  hostname — query secrets / signed tokens in the original URL are no longer
  disclosed to third-party hosts. `removeRefererHeader: true` still
  suppresses it entirely.
- **Security: response bodies can now be capped.** New `maxBytes` option —
  when the collected body exceeds the limit the request aborts with an
  `EBODYLIMIT` error instead of buffering unbounded data (zip-bomb / runaway
  server protection).
- **Security: `toJSON()` no longer serializes credentials.** `requestToJSON`
  / `responseToJSON` strip `authorization`, `proxy-authorization`, `cookie`,
  `set-cookie`, `x-api-key` and `api-key` headers, so logging a serialized
  request/response object cannot leak secrets.
- **`paginate()` now has safety caps**: default `countLimit: 1000` and
  `requestLimit: 100` (was `Infinity`) stop a malicious/looping `next` link
  from fanning out requests forever. Raise them explicitly for larger jobs.

## v1.0.0 (2026-08-15)

Modern remake of the classic `request` package, published as `@zelthr/request`.

### Breaking changes (vs. `request` 2.x)

- Requires Node.js >= 18; all legacy Node 0.x/4.x/6.x support is gone.
- Removed integrations: AWS signature, Hawk, OAuth signing, HAR, `unix:`
  sockets, and browser builds. Scope is core + redirects + streams + forms +
  cookies + proxies + auth.
- The package no longer reads `request-debug` / `request-debug.js` or the
  `.request.json` config file.
- `request.debug` is now a static toggle: `request.debug = true`.

### New features

- **Native promises**: the `Request` object returned by any `request(...)`
  call is a thenable — `await request(url)` resolves with the response (with
  `.body` populated) and rejects on request errors and aborts. `.then()`,
  `.catch()` and `.finally()` work, and the callback/event/streaming APIs
  are unchanged.
- **Hooks** (Got-style): `hooks.beforeRequest` — called with the request
  before every attempt; may mutate it, and throwing aborts the request.
  `hooks.afterResponse` — called with the final response; may return a
  replacement response or throw. Skipped on redirects. Both accept a single
  function or an array, and async functions are awaited in order.
- **Built-in retry**: opt-in via `retry: true` or `retry: { ... }` with
  `limit`, `methods`, `statusCodes` (429/503 by default), `errorCodes`,
  `maxRetryAfter`, exponential `backoff` (number or function) and optional
  `jitter`. Honors the `Retry-After` header. Only requests with replayable
  bodies (string/Buffer/array/none) are retried, so streamed uploads are
  never re-sent.
- **`request.promise(uri, options)`** — explicit promise helper alongside
  the existing thenable `Request`.
- **`request.paginate(uri, options)`** — async generator over paginated
  results, following `Link: rel="next"` headers or a `body.next` field, with
  `transform`, `filter`, `shouldContinue`, `nextUrl`, `countLimit`,
  `requestLimit` and `backoff` options.
- **Modern streaming**: request bodies accept Node `Readable`, web
  `ReadableStream` and async iterables; response streaming and backpressure
  are handled by the transport.
- **AbortController**: `request(...).abort()` cancels the underlying request
  via an `AbortSignal`; the `'abort'` event is unchanged.
- **TypeScript types**: built-in `src/index.d.ts` (`"types"` field) covering
  options, hooks, retry, pagination, responses and requests, plus a
  `npm run typecheck` script.
- **ESM support**: dual package via the `exports` map — `require()` and
  `import` both work, ESM importers get named exports (`get`, `post`,
  `promise`, `paginate`, ...) from `src/index.mjs`, and TypeScript resolves
  the matching declarations (`.d.ts` for CommonJS, `.d.mts` for ESM).

### Internal changes

- The transport is built directly on Node's built-in `http`/`https`/`http2`
  modules — HTTP/1.1 and HTTP/2 from one engine (ALPN `h2` for `https:`,
  h2c prior knowledge for `http:`). The public API is unchanged: same
  callbacks, events, verbs, streaming, redirects, cookies, gzip, auth, forms
  and promises.
- **Zero runtime dependencies**: the `form-data`, `mime-types`, `qs` and
  `tough-cookie` packages were replaced with in-house implementations that
  keep the same APIs, including `request.jar()`/`request.cookie()` and
  `FormData`-style `.form()` objects.
- **Modular source layout** under `src/`, one folder per concern, each with
  its own `index.js` as the module's public surface:
  - `src/core/` — request lifecycle: `Request` class, init/start/response
    state machine, redirect and auth.
  - `src/transport/` — wire-level I/O: HTTP/1.1 dispatch (with CONNECT
    tunneling), HTTP/2, connection pooling, TLS options, shared body
    writing and error helpers.
  - `src/body/` — body and query encoders: multipart forms, urlencoded
    forms, the query-string serializer/parser and the MIME lookup table.
  - `src/cookie/` — RFC 6265 cookie jar.
  - `src/cache/` — RFC 7234 HTTP cache (`HttpCache`, shared `defaultCache`).
  - `src/mock/` — global mocking layer (`request.mock`).
  - `src/util/` — shared utilities: object/string helpers, serialization,
    timings, retry policy, proxy resolution, DNS cache and progress events.
  - Entry points stay at `src/index.js` (CommonJS), `src/index.mjs` (ESM)
    and `src/index.d.ts` / `src/index.d.mts` (types).
- **Connection pooling**: shared keep-alive pool by default; `pool: false`
  opens a fresh connection per request; custom agents via the `agent`
  option; pools keyed by TLS settings so `ca`/`rejectUnauthorized`/client
  certificates don't leak between requests; `request.closePool()` closes all
  pooled connections and HTTP/2 sessions.
- **Proxies**: HTTP absolute-form, HTTPS CONNECT tunneling (automatic),
  proxy credentials from the proxy URL, and `HTTP_PROXY`/`HTTPS_PROXY`/
  `NO_PROXY` env support. The custom tunnel code is gone; `tunnel` is
  accepted as a no-op for compatibility.
- Timeouts are implemented on the socket: idle timeout before the response
  maps to `ETIMEDOUT` with `err.connect === true`; after the response
  headers arrive it maps to `ESOCKETTIMEDOUT`. One timeout listener per
  socket (tracked via a WeakMap), so reused keep-alive connections never
  accumulate listeners.
- Test suite runs on `node --test` with committed test certificates
  (`tests/ssl/ca`).