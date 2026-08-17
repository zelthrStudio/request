import request, { get, head, options, post, put, patch, promise, paginate, closePool, del, defaults, cache, mock, reset, Request } from '../src/index.mjs'
import type { CoreOptions, Response, RetryOptions, HookOptions, PaginationOptions, Cookie, CookieJar, PromiseFunction } from '../src/index.mjs'
import webRequest, { get as webGet, promise as webPromise, initParams as webInitParams, Request as WebRequestClass } from '../src/web/index.mjs'
import type { WebOptions, WebResponse, WebRequest, PromiseFunction as WebPromiseFunction } from '../src/web/index.mjs'

async function run (): Promise<void> {
  // Default import, await style
  const response: Response = await request('http://example.com', { json: true })
  const status: number = response.statusCode
  const headers = response.headers
  void status
  void headers

  // Verb helpers
  const viaGet: Response = await get({ uri: 'http://example.com' })
  const viaHead: Response = await head('http://example.com')
  const viaOptions: Response = await options('http://example.com')
  const viaPost: Response = await post('http://example.com', { body: 'x' })
  const viaPut: Response = await put('http://example.com', { body: 'x' })
  const viaPatch: Response = await patch('http://example.com', { body: 'x' })
  void viaGet
  void viaHead
  void viaOptions
  void viaPost
  void viaPut
  void viaPatch

  // Explicit promise helper and verbs
  const viaPromise: Response = await promise('http://example.com')
  const viaPromiseGet: Response = await promise.get('http://example.com')
  void viaPromise
  void viaPromiseGet

  // Named 'delete' alias
  const viaDel: Response = await del('http://example.com')
  void viaDel

  // Pagination generator
  for await (const item of paginate<string>('http://example.com', { json: true })) {
    item.toUpperCase()
  }

  // defaults wrapper
  const client = defaults({ baseUrl: 'http://example.com', retry: true })
  const viaClient: Response = await client.promise('/path')
  const viaClientOptions: Response = await client.options('/path')
  void viaClient
  void viaClientOptions

  // Cache & mock
  cache.clear()
  mock.clear()
  reset()

  // Types
  const opts: CoreOptions = { uri: 'http://example.com', retry: { limit: 2 } as RetryOptions }
  const hooks: HookOptions = { beforeRequest: [async function (req) { req.setHeader('x', 'y') }] }
  const pag: PaginationOptions = { countLimit: 5 }
  const req: InstanceType<typeof Request> = new Request(opts)
  void hooks
  void pag
  void req

  // Web client ESM
  const webRes: WebResponse = await webPromise('http://example.com', { json: true })
  const webViaGet: WebResponse = await webGet('http://example.com')
  const webParams: WebOptions = webInitParams('http://example.com', { timeout: 1000 })
  const webReq: WebRequest = new WebRequestClass(webParams)
  void webRes
  void webViaGet
  void webReq

  closePool()
}

void run