# Change Log

## [1.2.0] — 2026-08-15 — reliability features: dedupe, schema, circuit breaker, rate limit

### Added

- **Request deduplication (`dedupe: true`):** concurrent identical GET/HEAD
  requests to the same URL coalesce onto a single network request; waiters
  are served a buffered copy of the response (`response.fromDedupe`). Only
  idempotent methods coalesce, so a non-idempotent POST is never silently
  merged. Errors and aborts on the primary propagate to every waiter.
- **Response schema validation (`schema`):** the parsed body is validated
  before delivery using a joi-style (`.validate`), zod-style (`.parse`, the
  original error such as `ZodError` propagates), valibot-style
  (`.safeParse`) validator, or a plain function. The validated/transformed
  value replaces `response.body`; validation failures reject the request
  (the validators stay optional peer dependencies — no runtime deps).
- **Circuit breaker (`circuitBreaker`):** per-`host:port` state (ports never
  share a circuit) that opens after `threshold` consecutive final failures,
  fails subsequent requests fast with `error.code = 'CB_OPEN'` and allows a
  single half-open probe after `cooldown`. A successful probe closes the
  circuit; schema-validation failures and user aborts never trip it.
- **Per-host rate limiting (`rateLimit`):** a token bucket per `host:port`
  with `rate` (tokens/second) and burst `capacity`. Concurrent waiters queue
  in-process without over-issuing, and an abort while waiting rejects with
  `AbortError`.

## [1.1.2] — 2026-08-15 — security & bug audit pass 2 (report-1.md)

### Fixed

- **Security (HIGH): a malformed `Location` header no longer crashes the
  process.** An unparseable redirect URL (`302 Location: http://[`) threw out
  of `handleRequestResponse`, propagated through an unawaited call chain and
  became an unhandled promise rejection (fatal on Node ≥15). The URL is now
  parsed under try/catch and routed through the request error path, and the
  `onRequestResponse` chain in `start()` is awaited so no rejection escapes
  to the event loop. Angle-bracketed `Location` values (`<http://x>`) are
  treated as no-redirect instead of silently redirecting to a garbage path.
- **Security: a custom `lookup` can no longer be bypassed by socket reuse.**
  The pool key now includes the `lookup` function, so a request with a DNS
  pinning/SSRF-guard resolver never reuses a keep-alive socket created by a
  request without it. Plain-http requests with `lookup`/`localAddress`/
  `family` get a dedicated agent instead of the shared one, proxy and custom
  pool agents carry the connect options, and HTTP/2 sessions are keyed the
  same way.
- **Security: the shared HTTP cache no longer stores cookie-scoped or
  `Cache-Control: private` responses**, so one request's session data can
  never be served to another request for the same URL. The cache also has a
  total byte budget (`maxBytes`, default 64 MB) in addition to `maxEntries`,
  and eviction now refreshes recency (delete-then-set), so hot URLs are no
  longer evicted first.
- **Security: the CONNECT tunnel phase has a timeout.** A proxy that accepts
  TCP but never answers CONNECT used to hang the request forever, even with
  `timeout` set; the request timeout now applies to the tunnel phase too.
- **Security: proxy absolute-form request lines and redirect Referers no
  longer carry URL credentials.** `http://user:pass@host/...` sent through a
  proxy now yields `http://host/...` (fragment excluded), and the Referer on
  a same-host redirect is stripped of userinfo and fragment.
- **Security: `qs()` with a URL fragment no longer swallows the query** — the
  query is set via `uri.search`, preserving the fragment.
- **Security: the public-suffix table now covers `co.ke`, `co.ug`, `co.tz`,
  `co.rw`, `co.bw`, `co.na`, `co.zm`, `co.zw`, `co.mw`, `co.mz`, `co.sz`,
  `co.ls`, `co.bi`, `co.ao`, `co.mg`, `co.mu`, `co.sc`, `co.cr`, `co.ni`,
  `co.sv`, `co.hn`, `co.gt`, `co.do`, `co.py`, `co.uy`, `co.ec` and friends**,
  so those registrable zones can no longer be claimed via a `Domain=`
  attribute.
- **Security: the digest nonce counter map is capped** (LRU eviction past
  1000 entries), so a server rotating nonces per request can no longer leak a
  Map entry per nonce for the process lifetime.
- **HTTP/2 session fixes**: a single `'error'` listener settles the
  connecting promise (was registered twice), a wall-clock timeout (the
  request `timeout`, or 30 s) covers TLS/ALPN stalls that `connectTimeout`
  cannot see — a server that accepts TCP but never completes the handshake
  no longer hangs every request to that origin — and `closeSessions()`
  destroys sessions still mid-connection so shutdown no longer leaks sockets.
- **Non-ASCII array/multipart bodies are no longer truncated.** The
  `content-length` for array bodies now sums UTF-8 byte lengths (not UTF-16
  code units) and multipart builds buffer string parts, so a Thai body is
  sent whole instead of being cut mid-character and desyncing keep-alive
  parsing.
- **`request.promise()` rejects instead of throwing synchronously** on
  invalid URIs; **`defaults().cookie` actually parses cookie strings** (was
  always null); **`qs.stringify` reports a clear error on circular objects**
  instead of overflowing the stack; the **cookie jar prunes expired
  cookies** on read/set, so rotating cookie names can no longer grow memory
  without bound.
- **A 307/308 redirect of a streamed body fails loudly** ("the streamed
  request body has already been consumed") instead of silently re-sending an
  empty body.
- **Unsupported request body types error instead of sending an empty
  request** (e.g. `body: 0`).
- **Agent pools are capped** (LRU eviction of the least recently used agent
  maps: 100 https, 50 http/proxy/custom), so a per-tenant CA pattern cannot
  exhaust file descriptors; custom pool agents now honor TLS/socket connect
  options instead of silently dropping them.
- **`request.reset()` clears the global mock handlers**, and the DNS cache
  drops TTL-expired entries immediately instead of only lazily replacing
  them.

### Notes

- The Set-Cookie fallback split regex is retained: it only runs when neither
  `rawHeaders` (http/1.x) nor the header array (http/2) carries the
  set-cookie values (fabricated/mock responses), and it is bounded by Node's
  16 KB `maxHeaderSize`.
- The 304-refresh validator handling was already correct (validators are
  never overwritten); a regression test now pins the stored
  `content-length` and body across revalidation.

## [1.1.1] — 2026-08-15 — security & bug-fix audit (report.md)

### Fixed

- **Security (HIGH): cookies are no longer forwarded across hostnames on
  redirect.** A `Cookie` header set for the original host is removed when the
  redirect target changes hostname, and `jar()` only merges the pre-redirect
  cookie header back when the target keeps the same hostname — so an open
  redirect can no longer harvest cookies scoped to the source host.
- **Security (HIGH): `paginate()` refuses cross-origin `next` URLs by
  default.** A malicious/compromised API can no longer point pagination at an
  attacker (or internal) host and receive the original request's
  Authorization/cookies/API keys. `paginate.allowCrossOrigin: true` opts back
  in. `countLimit: 0` / `requestLimit: 0` now genuinely disable the caps
  instead of silently becoming 1000/100.
- **Security: Set-Cookie parsing no longer splits on `', '`.** Response
  cookies are taken from `rawHeaders` (http/1.x) or the header array (http/2);
  the joined-string fallback only splits on a `, ` that is followed by a
  cookie name. A cookie with `Expires=Wed, 21 Oct 2026 ...` keeps its expiry
  and the garbage `21 Oct 2026 ... GMT=` cookie is no longer stored.
- **Security: collected bodies now have a default size cap.** When the body is
  buffered in memory (callback/promise mode) the default limit is 100 MB,
  replaceable with `maxBytes` (the option is now actually wired up). Stream
  mode is unaffected unless the caller opts in.
- **Security: serialization strips URL userinfo.** `request.toJSON()` no
  longer emits `user:pass@` in the URI, and `response.toJSON()` redacts
  `set-cookie` like the other sensitive headers.
- **Security: malformed percent-encoding in URI/proxy credentials no longer
  throws synchronously.** `request('http://%zz:pass@host/')` now emits an
  error instead of crashing the caller with a `URIError` from the
  constructor; a bad proxy credential is skipped rather than thrown.
- **Security: `Domain` cookies for two-label public suffixes are rejected.**
  `evil.co.uk` can no longer set `Domain=co.uk` (or `com.au`, `co.jp`, `co.th`,
  `com.br`, ...) into the jar — the PSL table now covers the common
  two-label suffixes.
- **Security: multipart/form-data header injection is blocked.** Quotes and
  CR/LF are stripped from `name`/`filename`/`content-type` in `formData` and
  from multipart part option keys/values, so a hostile filename can no longer
  smuggle extra headers into the request body.
- **Security: digest `realm`/`nonce`/`opaque` values are sanitized.** CR/LF
  and quotes are stripped from server-controlled challenge values before
  building the `Authorization` header.
- **`qs.parse` no longer corrupts bracket notation.** `a[0]=1&a[1]=2` and
  `a[]=1&a[]=2` keep all values, `a[0]=1&a[x]=2` converts to an object
  preserving the index, bare `=value` is skipped instead of throwing, and
  `append` uses `hasOwnProperty` so `a[toString]=1` cannot clobber inherited
  methods.
- **Multipart with a stream part no longer crashes.** The combined stream
  terminates itself after the last part; the eager `end()` that produced
  `ERR_STREAM_WRITE_AFTER_END` is gone.
- **`max-age=abc` in the cache no longer means "never stale".** Malformed
  directives fall back to Expires/last-modified heuristics and the cache TTL,
  and a 304 revalidation no longer overwrites the stored `content-length`
  with the (usually 0) 304 header.
- **`then()` after an error rejects instead of hanging.** Every error path
  now records `_errored`/`_error`; a promise attached after the failure (e.g.
  an `await`-only caller) rejects immediately.
- **308 redirects preserve the method and body** (like 307), so POST data is
  no longer dropped on permanent redirects.
- **`pool: { maxSockets }` / `agentOptions` / `forever: {...}` are honored**
  through a dedicated cached agent per settings object, and `family` is passed
  to the transport — previously typed in the d.ts but silently ignored.
- **`NO_PROXY` now requires a full-label match.** `oogle.com` no longer
  bypasses the proxy for `google.com`, and empty zones no longer match
  everything.
- **HTTP/2 session pooling is race-free**: the in-flight connect promise is
  stored in the session map so concurrent first requests to a fresh origin
  share one session.
- **Mock matchers with `/g` (or `/y`) regexes are stateless** — `lastIndex`
  is reset before each `test()`.
- **Digest auth `nc` increments per nonce** instead of always sending
  `00000001`.
- **`connectSignature` hashes the full CA/cert buffers (sha256)** and gives
  function options stable ids, so two different CAs sharing a 32-byte prefix
  (or two `checkServerIdentity` functions with the same arity) can no longer
  collide in the HTTPS agent pool.
- **`extend()`/`copy()` skip `__proto__`/`constructor`/`prototype` keys**, so
  options parsed from untrusted JSON can no longer mutate the target's
  prototype.
- **MIME table expanded**: `.yaml/.yml`, `.heic/.heif`, `.apng`, `.m4a`,
  `.flac`, `.aac`, `.mkv`, `.mov`, `.ts`, `.map`, and `.js/.mjs` now resolve
  to `text/javascript`.

### Tests

- New `tests/test-security.js` (26 tests) covering every audit finding
  (redirect cookie stripping, cross-origin pagination, Set-Cookie expiry,
  maxBytes, serialization redaction, bad percent-encoding, post-error
  promises, public-suffix cookies, multipart/digest header injection, stream
  multipart parts, qs brackets, cache max-age + 304 content-length, pool
  options, NO_PROXY labels, stateful mocks, MIME table, digest nc, and
  prototype-pollution guards). Full suite: 155 tests passing.

## v1.1.0 (2026-08-15) — caching, DNS, brotli, progress, mocking & throughput

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

## v1.0.1 (2026-08-15) — hardening & performance

### Fixed

- **Security: the cookie jar now validates the `Domain` attribute** before
  storing a cookie. A `Set-Cookie` whose `Domain` does not domain-match the
  request host (or is a bare single-label TLD such as `Domain=com`) is
  rejected, so a malicious server can no longer poison the shared jar with
  cookies scoped to another host.
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

### Changed

- Reserved-option validation (`__proto__`/`constructor` key checks) now uses a
  cached property-name `Set` instead of re-deriving prototype names per
  request, removing the per-request allocation in the hot path.

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