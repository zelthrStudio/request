# Change Log

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
  - `src/util/` — shared utilities: object/string helpers, serialization,
    timings, retry policy and proxy resolution.
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