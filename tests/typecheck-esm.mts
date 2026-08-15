import request, { get, post, promise, paginate, closePool, del, defaults, Request } from '../src/index.mjs'
import type { CoreOptions, Response, RetryOptions, HookOptions, PaginationOptions } from '../src/index.mjs'

async function run (): Promise<void> {
  // Default import, await style
  const response: Response = await request('http://example.com', { json: true })
  const status: number = response.statusCode
  const headers = response.headers
  void status
  void headers

  // Verb helpers
  const viaGet: Response = await get({ uri: 'http://example.com' })
  const viaPost: Response = await post('http://example.com', { body: 'x' })
  void viaGet
  void viaPost

  // Explicit promise helper
  const viaPromise: Response = await promise('http://example.com')
  void viaPromise

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
  void viaClient

  // Types
  const opts: CoreOptions = { uri: 'http://example.com', retry: { limit: 2 } as RetryOptions }
  const hooks: HookOptions = { beforeRequest: [async function (req) { req.setHeader('x', 'y') }] }
  const pag: PaginationOptions = { countLimit: 5 }
  const req: InstanceType<typeof Request> = new Request(opts)
  void hooks
  void pag
  void req

  closePool()
}

void run