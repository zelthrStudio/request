/// <reference lib="dom" />

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

// Web & Edge runtime entry (@zelthr/request/web, alias ./edge): a
// fetch-based client for Next.js middleware/Edge, Vercel Edge Functions,
// Cloudflare Workers, Deno and browsers. Responses are buffered plain
// objects (no Node streams).

declare const request: requestWeb.Static

declare namespace requestWeb {
  type Headers = Record<string, string | string[] | undefined>

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

  interface WebOptions {
    uri?: string | URL
    url?: string | URL
    method?: string
    baseUrl?: string
    headers?: Headers
    body?: string | Uint8Array | ArrayBuffer | Blob | FormData | URLSearchParams | ReadableStream
    qs?: Record<string, any>
    form?: Record<string, any> | string
    formData?: FormData
    json?: any | boolean
    auth?: {
      user?: string
      username?: string
      pass?: string
      password?: string
      sendImmediately?: boolean
      bearer?: string
    }
    timeout?: number
    time?: boolean
    /** Maximum collected response-body bytes; errors with code `EBODYLIMIT`. */
    maxBytes?: number
    encoding?: string | null
    followRedirect?: boolean | ((response: WebResponse) => boolean)
    followAllRedirects?: boolean
    followOriginalHttpMethod?: boolean
    maxRedirects?: number
    /** Coalesce concurrent identical GET/HEAD requests onto one fetch. */
    dedupe?: boolean
    /** Validate the parsed response body (joi/zod/valibot-style validator or a function). */
    schema?: SchemaValidator
    /** Fail fast per host after repeated failures: true (defaults), threshold, or options. */
    circuitBreaker?: boolean | number | CircuitBreakerOptions
    /** Per-host request rate: true (defaults), req/sec, or { rate, capacity }. */
    rateLimit?: boolean | number | RateLimitOptions
    /** `gzip` is a no-op: fetch advertises accept-encoding and decompresses automatically. */
    gzip?: boolean
    hooks?: {
      beforeRequest?: (request: WebRequest) => any | Array<(request: WebRequest) => any>
    }
    callback?: RequestCallback
  }

  interface WebResponse {
    statusCode: number
    statusMessage?: string
    headers: Record<string, string>
    httpVersion: string
    body: any
    request: WebRequest
    toJSON (): any
    /** True when the response was replayed by in-flight request deduplication. */
    fromDedupe?: boolean
    /** Total wall-clock time in ms when `time: true`. */
    elapsedTime?: number
    timings?: { total: number }
  }

  interface WebRequest {
    uri: URL
    method: string
    headers: Headers
    response?: WebResponse
    setHeader (name: string, value: string | string[] | undefined, merge?: boolean): this
    setHeader (headers: Headers, merge?: boolean): this
    getHeader (name: string): string | string[] | undefined
    hasHeader (name: string): boolean
    removeHeader (name: string): void
    abort (): void
    start (): void
    on (event: string, listener: (...args: any[]) => void): this
    on (event: 'error', listener: (err: Error) => void): this
    on (event: 'response', listener: (response: WebResponse) => void): this
    on (event: 'complete', listener: (response: WebResponse, body: any) => void): this
    once (event: string, listener: (...args: any[]) => void): this
    then<TResult1 = WebResponse, TResult2 = never> (
      onfulfilled?: ((value: WebResponse) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2>
    catch<TResult = never> (onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null): Promise<WebResponse | TResult>
    finally (onfinally?: (() => void) | null): Promise<WebResponse>
  }

  type RequestCallback = (error: Error | null, response?: WebResponse, body?: any) => void

  interface Defaults extends RequestFunction {
    get: RequestFunction
    head: RequestFunction
    options: RequestFunction
    post: RequestFunction
    put: RequestFunction
    patch: RequestFunction
    del: RequestFunction
    delete: RequestFunction
    promise: (uri: string | URL | WebOptions, options?: WebOptions) => Promise<WebResponse>
  }

  interface Static {
    (uri: string | URL, options?: WebOptions, callback?: RequestCallback): WebRequest
    (uri: string | URL, callback?: RequestCallback): WebRequest
    (options: WebOptions, callback?: RequestCallback): WebRequest

    get: RequestFunction
    head: RequestFunction
    options: RequestFunction
    post: RequestFunction
    put: RequestFunction
    patch: RequestFunction
    del: RequestFunction
    delete: RequestFunction
    promise: (uri: string | URL | WebOptions, options?: WebOptions) => Promise<WebResponse>
    defaults: (options: WebOptions) => Defaults
  }

  type RequestFunction = (uri: string | URL | WebOptions, options?: WebOptions, callback?: RequestCallback) => WebRequest
}

export = request