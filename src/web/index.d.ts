/// <reference lib="dom" />

declare const request: requestWeb.Static

declare namespace requestWeb {
  type Headers = Record<string, string | string[] | undefined>

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

  interface WebOptions {
    uri?: string | URL
    url?: string | URL
    method?: string
    baseUrl?: string | URL
    headers?: Headers
    body?: string | Uint8Array | ArrayBuffer | Blob | FormData | URLSearchParams | ReadableStream
    qs?: Record<string, any> | string | URLSearchParams
    form?: Record<string, any> | string | URLSearchParams
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
    maxBytes?: number
    encoding?: string | null
    followRedirect?: boolean | ((response: WebResponse) => boolean)
    followAllRedirects?: boolean
    followOriginalHttpMethod?: boolean
    maxRedirects?: number
    dedupe?: boolean
    schema?: SchemaValidator
    circuitBreaker?: boolean | number | CircuitBreakerOptions
    rateLimit?: boolean | number | RateLimitOptions
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
    fromDedupe?: boolean
    elapsedTime?: number
    timings?: { total: number }
  }

  interface PromiseFunction {
    (uri: string | URL | WebOptions, options?: WebOptions): Promise<WebResponse>
    get (uri: string | URL | WebOptions, options?: WebOptions): Promise<WebResponse>
    head (uri: string | URL | WebOptions, options?: WebOptions): Promise<WebResponse>
    options (uri: string | URL | WebOptions, options?: WebOptions): Promise<WebResponse>
    post (uri: string | URL | WebOptions, options?: WebOptions): Promise<WebResponse>
    put (uri: string | URL | WebOptions, options?: WebOptions): Promise<WebResponse>
    patch (uri: string | URL | WebOptions, options?: WebOptions): Promise<WebResponse>
    del (uri: string | URL | WebOptions, options?: WebOptions): Promise<WebResponse>
    delete (uri: string | URL | WebOptions, options?: WebOptions): Promise<WebResponse>
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
    removeHeader (name: string): this
    qs (q: Record<string, any> | string | URLSearchParams, clobber?: boolean): this
    form (form?: Record<string, any> | string | URLSearchParams): this
    json (val?: any): this
    auth (user: string, pass?: string, sendImmediately?: boolean, bearer?: string): this
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
    promise: PromiseFunction
    defaults (options: WebOptions): Defaults
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
    promise: PromiseFunction
    defaults: (options: WebOptions) => Defaults
    initParams: (uri: string | URL | WebOptions, options?: WebOptions, callback?: RequestCallback) => WebOptions
    Request: new (options: WebOptions) => WebRequest
  }

  type RequestFunction = (uri: string | URL | WebOptions, options?: WebOptions, callback?: RequestCallback) => WebRequest
}

export = request