/// <reference types="node" />

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

import { Duplex } from 'stream'
import { Agent as HttpAgent } from 'http'

declare const request: request.Static

declare namespace request {
  type Headers = Record<string, string | string[] | undefined>

  interface Cookie {
    key: string
    value: string
    name: string
    path: string
    domain: string | null
    expires: Date | null
    maxAge: number | null
    secure: boolean
    httpOnly: boolean
    toString (): string
  }

  interface CookieJar {
    // tough-cookie-style sync API, provided by the raw CookieJar class.
    setCookieSync (cookieOrStr: Cookie | string, url: string | URL): void
    getCookiesSync (url: string | URL): Cookie[]
    getCookieStringSync (url: string | URL): string
    // request-style API, provided by the jar returned from request.jar().
    // Both must be typed: request.jar() returns an object that only has the
    // non-Sync methods.
    setCookie (cookieOrStr: Cookie | string, url: string | URL, options?: Record<string, unknown>): void
    getCookies (url: string | URL): Cookie[]
    getCookieString (url: string | URL): string
  }

  interface Static {
    (uri: string | URL, options?: CoreOptions, callback?: RequestCallback): Request
    (uri: string | URL, callback?: RequestCallback): Request
    (options: CoreOptions, callback?: RequestCallback): Request

    get: RequestFunction
    head: RequestFunction
    options: RequestFunction
    post: RequestFunction
    put: RequestFunction
    patch: RequestFunction
    del: RequestFunction
    delete: RequestFunction
    cookie: (str: string) => Cookie
    jar: (store?: any) => CookieJar
    /** Shared RFC 7234 cache used by `cache: true`. */
    cache: HttpCache
    /** Global mocking layer. */
    mock: MockApi
    defaults: (options: CoreOptions, requester?: RequestFunction) => Defaults
    forever: (agentOptions?: Record<string, any>, optionsArg?: CoreOptions) => Defaults
    promise: (uri: string | URL | CoreOptions, options?: CoreOptions) => Promise<Response>
    paginate: <T = any> (uri: string | URL | CoreOptions, options?: CoreOptions) => AsyncIterableIterator<T>
    closePool: () => void
    initParams: (uri: string | URL | CoreOptions, options?: CoreOptions, callback?: RequestCallback) => CoreOptions
    Request: new (options: CoreOptions) => Request
  }

  interface AuthOptions {
    user?: string
    username?: string
    pass?: string
    password?: string
    sendImmediately?: boolean
    bearer?: string
  }

  interface RetryOptions {
    /** Maximum number of retries (default 3). */
    limit?: number
    /** Methods that may be retried (default GET/HEAD/OPTIONS/PUT/DELETE). */
    methods?: string[]
    /** Status codes that trigger a retry (default 429 and 503). */
    statusCodes?: number[]
    /** Error codes that trigger a retry. */
    errorCodes?: string[]
    /** Upper bound in ms for Retry-After delays (default 30000). */
    maxRetryAfter?: number
    /** Base delay in ms (exponential) or a function returning the delay. */
    backoff?: number | ((attempt: number, error: Error | null, response?: Response | null) => number)
    /** Add random jitter (number = max extra ms, true = 25% of the delay). */
    jitter?: boolean | number
  }

  interface CircuitBreakerOptions {
    /** Consecutive failures before the circuit opens. @default 5 */
    threshold?: number
    /** Cooldown in ms before a half-open probe is allowed. @default 30000 */
    cooldown?: number
  }

  interface RateLimitOptions {
    /** Requests per second per host. @default 10 */
    rate?: number
    /** Burst capacity (how many requests may start at once). @default rate */
    capacity?: number
  }

  type SchemaValidator =
    | ((body: any) => any)
    | { validate (value: any): { error?: Error; value?: any } }
    | { parse (value: any): any }
    | { safeParse (value: any): { success: boolean; output?: any; issues?: Array<{ path?: Array<string | number>; message?: string }> } }

  type BeforeRequestHook = (request: Request) => any
  type AfterResponseHook = (response: Response) => any

  interface HookOptions {
    /** Runs before each attempt; may mutate the request or throw to abort. */
    beforeRequest?: BeforeRequestHook | BeforeRequestHook[]
    /** Runs on the final response; may return a replacement response. */
    afterResponse?: AfterResponseHook | AfterResponseHook[]
  }

  interface PaginationOptions<T = any> {
    /** Maps a response to an iterable of items (default response.body). */
    transform?: (response: Response) => Iterable<T> | AsyncIterable<T> | undefined
    /** Skip items that do not pass the filter. */
    filter?: (item: T) => boolean
    /** Stop iterating when this returns false. */
    shouldContinue?: (response: Response) => boolean
    /** Resolve the URL of the next page (default: Link rel="next", then body.next). */
    nextUrl?: (response: Response, currentUrl: string) => string | null | undefined | Promise<string | null | undefined>
    /** Maximum number of yielded items. @default 1000 */
    countLimit?: number
    /** Maximum number of HTTP requests. @default 100 */
    requestLimit?: number
    /** Delay between page requests in ms. */
    backoff?: number
  }

  interface CoreOptions {
    uri?: string | URL
    url?: string | URL
    method?: string
    baseUrl?: string
    headers?: Headers
    body?: string | Buffer | NodeJS.ReadableStream | AsyncIterable<any> | ReadableStream | any[]
    qs?: Record<string, any> | string
    form?: Record<string, any> | string
    formData?: Record<string, any>
    multipart?: any[]
    json?: any | boolean
    auth?: AuthOptions
    jar?: CookieJar | boolean
    gzip?: boolean
    encoding?: string | null
    timeout?: number
    time?: boolean
    /** Maximum collected response-body bytes; aborts with code `EBODYLIMIT` when exceeded. */
    maxBytes?: number
    followRedirect?: boolean | ((response: Response) => boolean)
    followAllRedirects?: boolean
    followOriginalHttpMethod?: boolean
    maxRedirects?: number
    removeRefererHeader?: boolean
    strictSSL?: boolean
    rejectUnauthorized?: boolean
    ca?: string | Buffer | Array<string | Buffer>
    cert?: string | Buffer
    key?: string | Buffer
    pfx?: string | Buffer | { buf: string | Buffer; passphrase?: string } | Array<string | Buffer | { buf: string | Buffer; passphrase?: string }>
    passphrase?: string
    ciphers?: string
    secureProtocol?: string
    secureOptions?: number
    checkServerIdentity?: (hostname: string, cert: any) => Error | undefined
    localAddress?: string
    family?: number
    proxy?: string | URL | false | null
    pool?: boolean | { maxSockets?: number }
    agent?: HttpAgent
    http2?: boolean
    /** Wall-clock budget (ms) for the HTTP/2 connection phase (TCP+TLS+ALPN); defaults to the request `timeout` or 30 s. */
    http2ConnectTimeout?: number
    /** RFC 7234 HTTP cache: true (shared), an HttpCache instance, or { ttl, maxEntries }. */
    cache?: boolean | HttpCache | { ttl?: number; maxEntries?: number }
    /** DNS result cache: true (shared), a custom lookup function, or { ttl, max }. */
    dnsCache?: boolean | DnsLookup | { ttl?: number; max?: number }
    /** Custom DNS lookup function passed to the transport (net.connect compatible). */
    lookup?: DnsLookup
    /** Additionally accept and decode Brotli (br) responses when gzip is enabled. */
    brotli?: boolean
    /** Emit `progress` events while uploading and downloading. */
    progress?: boolean
    /** Mock this request: a static response spec or a function returning one (or null to pass through). */
    mock?: MockSpec | ((uri: URL, request: Request) => MockSpec | null | undefined | Promise<MockSpec | null | undefined>)
    retry?: boolean | number | RetryOptions
    /** Coalesce concurrent identical GET/HEAD requests onto one network request. */
    dedupe?: boolean
    /** Validate the parsed response body (joi/zod/valibot-style validator or a function). */
    schema?: SchemaValidator
    /** Fail fast per host after repeated failures: true (defaults), threshold, or options. */
    circuitBreaker?: boolean | number | CircuitBreakerOptions
    /** Per-host request rate: true (defaults), req/sec, or { rate, capacity }. */
    rateLimit?: boolean | number | RateLimitOptions
    hooks?: HookOptions
    paginate?: PaginationOptions
    forever?: boolean
    agentOptions?: Record<string, any>
    callback?: RequestCallback
  }

  interface Response extends NodeJS.ReadableStream {
    statusCode: number
    statusMessage?: string
    headers: Headers
    httpVersion: string
    body: any
    request: Request
    toJSON (): any
    /** True when the response was served from the RFC 7234 cache. */
    fromCache?: boolean
    /** True when the cached entry was refreshed by a 304 revalidation. */
    revalidated?: boolean
    /** True when the response came from the mocking layer. */
    isMock?: boolean
    /** True when the response was replayed by in-flight request deduplication. */
    fromDedupe?: boolean
    elapsedTime?: number
    timingStart?: number
    timings?: {
      wait: number
      dns: number
      tcp: number
      firstByte: number
      download: number
      total: number
      /** Bytes received during the download phase. */
      downloadBytes: number
      /** Download rate in bytes/second, relative to the download phase. */
      throughput: number
    }
    timingPhases?: Response['timings']
  }

  interface ProgressEvent {
    /** 'upload' or 'download'. */
    phase: 'upload' | 'download'
    uploaded: number
    uploadedTotal: number | null
    /** 0-100, null when the upload size is unknown. */
    uploadPercent: number
    downloaded: number
    downloadedTotal: number | null
    /** 0-100, null when the response size is unknown. */
    percent: number
    /** Download rate in bytes/second relative to the request start. */
    throughput: number
  }

  type DnsLookup = (hostname: string, options: { family?: number; all?: boolean }, callback: (err: Error | null, address: string | Array<{ address: string; family: number }>, family?: number) => void) => void

  interface HttpCache {
    /** Fallback freshness lifetime in ms when the response has no explicit lifetime. */
    ttl: number
    /** Maximum number of stored entries. */
    maxEntries: number
    clear (): void
    /** Number of stored entries. */
    readonly size: number
  }

  interface MockSpec {
    statusCode?: number
    headers?: Headers
    body?: string | Buffer | NodeJS.ReadableStream | ReadableStream
    httpVersion?: string
  }

  type MockMatcher = string | RegExp | ((uri: URL, request: Request) => boolean)
  type MockHandler = (uri: URL, request: Request) => MockSpec | null | undefined | Promise<MockSpec | null | undefined>

  interface MockApi {
    /** Register a global mock; matching requests are served without the network. */
    add (matcher: MockMatcher, handler: MockHandler): void
    /** Remove all global mocks. */
    clear (): void
    enable (): void
    disable (): void
  }

  interface Request extends Duplex, PromiseLike<Response> {
    uri: URL
    method: string
    headers: Headers
    body?: any
    response?: Response
    responseContent?: NodeJS.ReadableStream
    request?: Request

    setHeader (name: string, value: string | string[] | undefined, merge?: boolean): this
    setHeader (headers: Headers, merge?: boolean): this
    getHeader (name: string): string | string[] | undefined
    hasHeader (name: string): boolean
    removeHeader (name: string): void

    qs (q: Record<string, any>, clobber?: boolean): this
    form (form?: Record<string, any> | string): this
    multipart (multipart: any[]): this
    json (val?: any): this
    auth (user: string, pass: string, sendImmediately?: boolean, bearer?: string): this
    jar (jar?: CookieJar | boolean): this

    pipe<T extends NodeJS.WritableStream> (dest: T, opts?: { end?: boolean }): T

    abort (): void
    start (): void

    then<TResult1 = Response, TResult2 = never> (
      onfulfilled?: ((value: Response) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2>
    catch<TResult = never> (onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null): Promise<Response | TResult>
    finally (onfinally?: (() => void) | null): Promise<Response>

    on (event: string, listener: (...args: any[]) => void): this
    /** Fired while the body is uploaded or the response downloaded. */
    on (event: 'progress', listener: (progress: ProgressEvent) => void): this
  }

  type RequestCallback = (error: Error | null, response?: Response, body?: any) => void

  interface Defaults extends RequestFunction {
    get: RequestFunction
    head: RequestFunction
    options: RequestFunction
    post: RequestFunction
    put: RequestFunction
    patch: RequestFunction
    del: RequestFunction
    delete: RequestFunction
    cookie: (str: string) => Cookie
    jar: (store?: any) => CookieJar
    defaults (options: CoreOptions, requester?: RequestFunction): Defaults
    promise: (uri: string | URL | CoreOptions, options?: CoreOptions) => Promise<Response>
    paginate: <T = any> (uri: string | URL | CoreOptions, options?: CoreOptions) => AsyncIterableIterator<T>
  }

  type RequestFunction = (uri: string | URL | CoreOptions, options?: CoreOptions, callback?: RequestCallback) => Request
}

export = request