/// <reference types="node" />

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
    sameSite: string | null
    toString (): string
  }

  interface CookieJar {
    setCookieSync (cookieOrStr: Cookie | string, url: string | URL): void
    getCookiesSync (url: string | URL): Cookie[]
    getCookieStringSync (url: string | URL): string
    setCookie (cookieOrStr: Cookie | string, url: string | URL, options?: Record<string, unknown>): void
    getCookies (url: string | URL): Cookie[]
    getCookieString (url: string | URL): string
  }

  interface PromiseFunction {
    (uri: string | URL | CoreOptions, options?: CoreOptions): Promise<Response>
    get (uri: string | URL | CoreOptions, options?: CoreOptions): Promise<Response>
    head (uri: string | URL | CoreOptions, options?: CoreOptions): Promise<Response>
    options (uri: string | URL | CoreOptions, options?: CoreOptions): Promise<Response>
    post (uri: string | URL | CoreOptions, options?: CoreOptions): Promise<Response>
    put (uri: string | URL | CoreOptions, options?: CoreOptions): Promise<Response>
    patch (uri: string | URL | CoreOptions, options?: CoreOptions): Promise<Response>
    del (uri: string | URL | CoreOptions, options?: CoreOptions): Promise<Response>
    delete (uri: string | URL | CoreOptions, options?: CoreOptions): Promise<Response>
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
    cache: HttpCache
    mock: MockApi
    reset: () => void
    defaults: (options: CoreOptions, requester?: RequestFunction) => Defaults
    forever: (agentOptions?: Record<string, any>, optionsArg?: CoreOptions) => Defaults
    promise: PromiseFunction
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
    limit?: number
    methods?: string[]
    statusCodes?: number[]
    errorCodes?: string[]
    maxRetryAfter?: number
    backoff?: number | ((attempt: number, error: Error | null, response?: Response | null) => number)
    jitter?: boolean | number
  }

  interface CircuitBreakerOptions {
    threshold?: number
    cooldown?: number
  }

  interface RateLimitOptions {
    rate?: number
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
    beforeRequest?: BeforeRequestHook | BeforeRequestHook[]
    afterResponse?: AfterResponseHook | AfterResponseHook[]
  }

  interface PaginationOptions<T = any> {
    transform?: (response: Response) => Iterable<T> | AsyncIterable<T> | undefined
    filter?: (item: T) => boolean
    shouldContinue?: (response: Response) => boolean
    nextUrl?: (response: Response, currentUrl: string) => string | null | undefined | Promise<string | null | undefined>
    countLimit?: number
    requestLimit?: number
    backoff?: number
  }

  interface CoreOptions {
    uri?: string | URL
    url?: string | URL
    method?: string
    baseUrl?: string | URL
    headers?: Headers
    body?: string | Buffer | NodeJS.ReadableStream | AsyncIterable<any> | ReadableStream | any[]
    qs?: Record<string, any> | string | URLSearchParams
    form?: Record<string, any> | string | URLSearchParams
    formData?: Record<string, any>
    multipart?: any[]
    json?: any | boolean
    auth?: AuthOptions
    jar?: CookieJar | boolean
    gzip?: boolean
    encoding?: string | null
    timeout?: number
    time?: boolean
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
    http2ConnectTimeout?: number
    cache?: boolean | HttpCache | { ttl?: number; maxEntries?: number }
    dnsCache?: boolean | DnsLookup | { ttl?: number; max?: number }
    lookup?: DnsLookup
    brotli?: boolean
    progress?: boolean
    mock?: MockSpec | ((uri: URL, request: Request) => MockSpec | null | undefined | Promise<MockSpec | null | undefined>)
    retry?: boolean | number | RetryOptions
    dedupe?: boolean
    schema?: SchemaValidator
    circuitBreaker?: boolean | number | CircuitBreakerOptions
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
    fromCache?: boolean
    revalidated?: boolean
    isMock?: boolean
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
      downloadBytes: number
      throughput: number
    }
    timingPhases?: Response['timings']
  }

  interface ProgressEvent {
    phase: 'upload' | 'download'
    uploaded: number
    uploadedTotal: number | null
    uploadPercent: number
    downloaded: number
    downloadedTotal: number | null
    percent: number
    throughput: number
  }

  type DnsLookup = (hostname: string, options: { family?: number; all?: boolean }, callback: (err: Error | null, address: string | Array<{ address: string; family: number }>, family?: number) => void) => void

  interface HttpCache {
    ttl: number
    maxEntries: number
    clear (): void
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
    add (matcher: MockMatcher, handler: MockHandler): void
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
    promise: PromiseFunction
    paginate: <T = any> (uri: string | URL | CoreOptions, options?: CoreOptions) => AsyncIterableIterator<T>
  }

  type RequestFunction = (uri: string | URL | CoreOptions, options?: CoreOptions, callback?: RequestCallback) => Request
}

export = request