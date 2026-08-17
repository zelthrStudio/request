import request = require('../src')

// Callback style
request('http://example.com', function (err, response, body) {
  if (err) {
    return
  }
  const code: number = response!.statusCode
  const headers: Record<string, string | string[] | undefined> = response!.headers
  const text: string = body
  void code
  void headers
  void text
})

// Options object + await
async function run (): Promise<void> {
  const response = await request({
    uri: 'http://example.com',
    method: 'POST',
    json: { hello: 'world' },
    qs: { page: 1 },
    headers: { 'X-Custom': 'yes' },
    timeout: 5000,
    retry: { limit: 2, backoff: 100, statusCodes: [429, 503] },
    hooks: {
      beforeRequest: [
        async function (req) {
          req.setHeader('x-hooked', 'yes')
        }
      ],
      afterResponse: function (response) {
        return { statusCode: 200, headers: response.headers, body: 'replaced' }
      }
    },
    gzip: true,
    auth: { user: 'u', pass: 'p' },
    jar: true
  })
  const status: number = response.statusCode
  const version: string = response.httpVersion
  const body: any = response.body
  const timings = response.timings
  const total: number | undefined = timings && timings.total
  void status
  void version
  void body
  void total

  // Promise helper and verb helpers
  const viaPromise = await request.promise('http://example.com', { json: true })
  const viaPromise2 = await request.promise({ uri: 'http://example.com' })
  const viaPromiseGet = await request.promise.get('http://example.com')
  const viaPromisePost = await request.promise.post('http://example.com', { body: 'data' })
  const viaPromiseOptions = await request.promise.options('http://example.com')
  void viaPromise
  void viaPromise2
  void viaPromiseGet
  void viaPromisePost
  void viaPromiseOptions

  // Cookie sameSite
  const cookie: request.Cookie = request.cookie('foo=bar; SameSite=Lax')
  const sameSite: string | null = cookie.sameSite
  void sameSite

  // Pagination
  const pages: string[] = []
  for await (const item of request.paginate<string>('http://example.com', {
    json: true,
    paginate: { countLimit: 10, requestLimit: 3 }
  })) {
    pages.push(item)
  }

  // Verbs
  const post = await request.post({ uri: 'http://example.com', body: 'x' })
  const del = await request.del('http://example.com')
  const opt = await request.options('http://example.com')
  void post
  void del
  void opt

  // Defaults
  const client = request.defaults({ baseUrl: new URL('http://example.com'), retry: true })
  const viaClient = await client.promise('/path')
  const viaClientGet = await client.promise.get('/path')
  const response2 = await client.get('/path')
  const viaClientOpt = await client.options('/path')
  void viaClient
  void viaClientGet
  void response2
  void viaClientOpt

  // Custom agent / pooling
  const http = require('http') as typeof import('http')
  const agent = new http.Agent({ keepAlive: true, maxSockets: 4 })
  const response3 = await request({ uri: 'http://example.com', agent })
  void response3

  // Errors reject
  request.promise('http://example.com').catch(function (err) {
    const message: string = err.message
    void message
  })
}

// Web & Edge entry (@zelthr/request/web, alias ./edge)
async function runWeb (): Promise<void> {
  const web = require('../src/web')
  const response = await web.promise({
    uri: 'http://example.com',
    baseUrl: new URL('http://example.com'),
    json: true,
    dedupe: true,
    schema: {
      safeParse (body: any) {
        return { success: true, output: body }
      }
    },
    rateLimit: { rate: 5, capacity: 10 },
    circuitBreaker: true
  })
  const status: number = response.statusCode
  const headers: Record<string, string> = response.headers
  const body: any = response.body
  void status
  void headers
  void body

  const viaVerb = await web.get('http://example.com', { timeout: 1000 })
  const viaOpt = await web.options('http://example.com')
  const viaPromiseGet = await web.promise.get('http://example.com')
  void viaVerb
  void viaOpt
  void viaPromiseGet

  const client = web.defaults({ baseUrl: 'http://example.com', json: true })
  const viaClient = await client.promise('/x')
  const viaClientPost = await client.promise.post('/x', { body: 'test' })
  const viaClientOpt = await client.options('/x')
  void viaClient
  void viaClientPost
  void viaClientOpt

  const chainedReq = web('http://example.com')
    .qs({ a: 1 })
    .form({ x: 'y' })
    .json(true)
    .auth('user', 'pass')
  const chainedRes = await chainedReq
  void chainedRes
}

void run
void runWeb