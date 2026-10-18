import { vi } from 'vitest'

export function json(status: number, body: unknown, headers = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

export function errorEnvelope(status: number, code: string, message?: string) {
  return json(status, {
    success: false,
    statusCode: status,
    ...(message ? { message } : {}),
    error: { code },
  })
}

/** A fetch mock that records the outgoing `Request`s. */
export function mockFetch(...responses: Array<Response | Error>) {
  const calls: Request[] = []
  const fn = vi.fn(
    async (input: Request | string | URL, init?: RequestInit) => {
      calls.push(new Request(input, init))
      const next = responses.shift()
      if (!next) throw new Error('unexpected fetch')
      if (next instanceof Error) throw next
      return next
    },
  )
  return { fetch: fn as unknown as typeof globalThis.fetch, calls }
}

export const deviceStart = {
  deviceCode: 'dev-123',
  userCode: 'ABCD-EFGH',
  verificationUri: 'https://steel.test/device',
  verificationUriComplete: 'https://steel.test/device?code=ABCD-EFGH',
  interval: 5,
  expiresIn: 600,
}

export const deviceToken = {
  token: 'stl_pat_abcdefghijklmnopqrstuvwxyz012345',
  tokenId: 'tok_1',
  expiresAt: '2027-01-15T12:00:00.000Z',
  workspace: { id: 'ws_1', slug: 'demo', name: 'Demo' },
  scopes: ['api:read', 'api:write'] as Array<'api:read' | 'api:write'>,
  modules: ['SERVICE_DESK'] as Array<'SERVICE_DESK'>,
}
