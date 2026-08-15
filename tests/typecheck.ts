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

  // Promise helper
  const viaPromise = await request.promise('http://example.com', { json: true })
  const viaPromise2 = await request.promise({ uri: 'http://example.com' })
  void viaPromise
  void viaPromise2

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
  void post
  void del

  // Defaults
  const client = request.defaults({ baseUrl: 'http://example.com', retry: true })
  const viaClient = await client.promise('/path')
  const response2 = await client.get('/path')
  void viaClient
  void response2

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

void run