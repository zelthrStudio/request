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
    setCookieSync (cookieOrStr: Cookie | string, url: string | URL): void
    getCookiesSync (url: string | URL): Cookie[]
    getCookieStringSync (url: string | URL): string
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
    /** Maximum number of yielded items. */
    countLimit?: number
    /** Maximum number of HTTP requests. */
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
    retry?: boolean | number | RetryOptions
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
    elapsedTime?: number
    timingStart?: number
    timings?: {
      wait: number
      dns: number
      tcp: number
      firstByte: number
      download: number
      total: number
    }
    timingPhases?: Response['timings']
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