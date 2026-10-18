import { describe, expect, it } from 'vitest'
import { createSteelClient } from '../src/index.js'
import { deviceStart, errorEnvelope, json, mockFetch } from './helpers.js'

const me = {
  user: { id: 'u1', name: 'Ana', email: 'ana@example.com' },
  workspace: { id: 'ws_1', slug: 'demo', name: 'Demo' },
  scopes: ['api:read'],
  modules: ['CRM'],
  token: { id: 'tok_1', expiresAt: '2027-01-01T00:00:00.000Z' },
}

describe('createSteelClient', () => {
  it('unwraps the success envelope and sends the bearer token', async () => {
    const { fetch, calls } = mockFetch(
      json(200, { success: true, statusCode: 200, data: me }),
    )
    const client = createSteelClient({
      baseUrl: 'https://steel.test/',
      token: 'stl_pat_x',
      fetch,
      userAgent: 'steel-cli/1.0.0',
    })

    const result = await client.me()

    expect(result).toEqual({ ok: true, status: 200, data: me })
    expect(calls[0]?.url).toBe('https://steel.test/api/v1/me')
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer stl_pat_x')
    expect(calls[0]?.headers.get('user-agent')).toBe('steel-cli/1.0.0')
  })

  it('maps the error envelope, message and Retry-After', async () => {
    const { fetch } = mockFetch(
      json(
        429,
        {
          success: false,
          statusCode: 429,
          message: 'Muitas requisições',
          error: { code: 'RATE_LIMITED', details: { retryAfterSeconds: 30 } },
        },
        { 'retry-after': '30' },
      ),
    )
    const client = createSteelClient({ baseUrl: 'https://steel.test', fetch })

    const result = await client.me()

    expect(result).toEqual({
      ok: false,
      error: {
        status: 429,
        code: 'RATE_LIMITED',
        message: 'Muitas requisições',
        details: { retryAfterSeconds: 30 },
        retryAfterSeconds: 30,
      },
    })
  })

  it('falls back to a code from the status when the body is not an envelope', async () => {
    const { fetch } = mockFetch(
      new Response('<html>bad gateway</html>', { status: 401 }),
      new Response('', { status: 502 }),
    )
    const client = createSteelClient({ baseUrl: 'https://steel.test', fetch })

    const first = await client.me()
    const second = await client.me()

    expect(first).toEqual({
      ok: false,
      error: { status: 401, code: 'UNAUTHORIZED' },
    })
    expect(second).toEqual({
      ok: false,
      error: { status: 502, code: 'HTTP_ERROR' },
    })
  })

  it('turns transport failures into NETWORK_ERROR, TIMEOUT and ABORTED', async () => {
    const timeout = new DOMException('timed out', 'TimeoutError')
    const abort = new DOMException('aborted', 'AbortError')
    const { fetch } = mockFetch(new TypeError('fetch failed'), timeout, abort)
    const client = createSteelClient({ baseUrl: 'https://steel.test', fetch })

    const codes = []
    for (let i = 0; i < 3; i++) {
      const result = await client.me()
      codes.push(result.ok ? 'ok' : result.error.code)
    }

    expect(codes).toEqual(['NETWORK_ERROR', 'TIMEOUT', 'ABORTED'])
  })

  it('keeps the device flow endpoints anonymous', async () => {
    const { fetch, calls } = mockFetch(
      json(200, { success: true, statusCode: 200, data: deviceStart }),
      errorEnvelope(428, 'AUTHORIZATION_PENDING'),
    )
    const client = createSteelClient({
      baseUrl: 'https://steel.test',
      token: 'stl_pat_stale',
      fetch,
    })

    const start = await client.auth.startDevice({ deviceName: 'laptop' })
    const poll = await client.auth.pollDeviceToken('dev-123')

    expect(start).toEqual({ ok: true, status: 200, data: deviceStart })
    expect(poll).toEqual({
      ok: false,
      error: { status: 428, code: 'AUTHORIZATION_PENDING' },
    })
    expect(calls.map((call) => call.headers.get('authorization'))).toEqual([
      null,
      null,
    ])
    expect(await calls[0]?.json()).toEqual({ deviceName: 'laptop' })
    expect(await calls[1]?.json()).toEqual({ deviceCode: 'dev-123' })
  })

  describe('auth.revokeToken', () => {
    it('sends DELETE /api/v1/auth/token with the token and maps 204', async () => {
      const { fetch, calls } = mockFetch(new Response(null, { status: 204 }))
      const client = createSteelClient({
        baseUrl: 'https://steel.test',
        token: 'stl_pat_x',
        fetch,
      })

      const result = await client.auth.revokeToken()

      expect(result).toEqual({ ok: true, status: 204, data: null })
      expect(calls[0]?.method).toBe('DELETE')
      expect(new URL(calls[0]?.url ?? '').pathname).toBe('/api/v1/auth/token')
      expect(calls[0]?.headers.get('authorization')).toBe('Bearer stl_pat_x')
    })

    it('returns the envelope error and network failures', async () => {
      const { fetch } = mockFetch(
        errorEnvelope(401, 'UNAUTHORIZED'),
        new TypeError('fetch failed'),
      )
      const client = createSteelClient({
        baseUrl: 'https://steel.test',
        token: 'stl_pat_x',
        fetch,
      })

      expect(await client.auth.revokeToken()).toEqual({
        ok: false,
        error: { status: 401, code: 'UNAUTHORIZED' },
      })
      expect(await client.auth.revokeToken()).toEqual({
        ok: false,
        error: { status: 0, code: 'NETWORK_ERROR', message: 'fetch failed' },
      })
    })
  })

  describe('request', () => {
    it('sends query, JSON body and the token, and parses JSON', async () => {
      const { fetch, calls } = mockFetch(
        json(201, { success: true, statusCode: 201, data: { id: 'l1' } }),
      )
      const client = createSteelClient({
        baseUrl: 'https://steel.test',
        token: 'stl_pat_x',
        fetch,
      })

      const result = await client.request({
        method: 'post',
        path: '/api/v1/crm/leads',
        query: { tag: ['a', 'b'], limit: '5' },
        body: { name: 'Lead' },
      })

      expect(result.ok && result.data.status).toBe(201)
      expect(result.ok && result.data.body).toEqual({
        success: true,
        statusCode: 201,
        data: { id: 'l1' },
      })
      const call = calls[0]
      expect(call?.method).toBe('POST')
      expect(call?.url).toBe(
        'https://steel.test/api/v1/crm/leads?tag=a&tag=b&limit=5',
      )
      expect(call?.headers.get('content-type')).toBe('application/json')
      expect(call?.headers.get('authorization')).toBe('Bearer stl_pat_x')
      expect(await call?.json()).toEqual({ name: 'Lead' })
    })

    it('returns HTTP errors as a response and keeps text bodies', async () => {
      const { fetch, calls } = mockFetch(
        new Response('Not here', {
          status: 404,
          headers: { 'content-type': 'text/plain' },
        }),
        new Response('{oops', {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
        new Response(null, { status: 204 }),
      )
      const client = createSteelClient({ baseUrl: 'https://steel.test', fetch })

      const notFound = await client.request({ method: 'GET', path: '/x' })
      const broken = await client.request({ method: 'GET', path: '/y' })
      const empty = await client.request({ method: 'DELETE', path: '/z' })

      expect(notFound.ok && notFound.data).toMatchObject({
        status: 404,
        ok: false,
        body: 'Not here',
      })
      expect(broken.ok && broken.data.body).toBe('{oops')
      expect(empty.ok && empty.data).toMatchObject({ status: 204, body: null })
      expect(calls[0]?.headers.get('content-type')).toBeNull()
    })

    it('reports transport failures', async () => {
      const { fetch } = mockFetch(new TypeError('getaddrinfo ENOTFOUND'))
      const client = createSteelClient({ baseUrl: 'https://steel.test', fetch })

      const result = await client.request({ method: 'GET', path: '/x' })

      expect(result).toEqual({
        ok: false,
        error: {
          status: 0,
          code: 'NETWORK_ERROR',
          message: 'getaddrinfo ENOTFOUND',
        },
      })
    })
  })
})
