import { createHash } from 'node:crypto'
import { vi } from 'vitest'
import type { McpCredential } from '../src/lib/mcp-oauth.js'

export const BASE = 'https://homologacao.stratustelecom.com.br'
export const ISSUER = `${BASE}/api/auth`
export const RESOURCE = `${BASE}/api/mcp`

export const METADATA = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/oauth2/authorize`,
  token_endpoint: `${ISSUER}/oauth2/token`,
  registration_endpoint: `${ISSUER}/oauth2/register`,
  revocation_endpoint: `${ISSUER}/oauth2/revoke`,
  scopes_supported: ['mcp:read', 'mcp:write', 'offline_access'],
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  token_endpoint_auth_methods_supported: [
    'none',
    'client_secret_basic',
    'client_secret_post',
  ],
  code_challenge_methods_supported: ['S256'],
  authorization_response_iss_parameter_supported: true,
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const oauthError = (error: string, status = 400) =>
  json(status, { error, error_description: error })

export interface FakeSteelOptions {
  /** `expires_in` of access tokens (seconds). */
  expiresIn?: number
  /** Issue refresh tokens for `offline_access` (default true). */
  refresh?: boolean
  /** Answer the token endpoint with this status (simulates an outage). */
  tokenStatus?: number
  /** Answer the revocation endpoint with this status. */
  revokeStatus?: number
}

interface Code {
  clientId: string
  redirectUri: string
  challenge: string
  resource: string | null
  scope: string
}

/**
 * The Steel MCP authorization server and resource, in memory: RFC 9728 and
 * RFC 8414 metadata, dynamic registration, authorization code + PKCE (the
 * browser is `approve`/`deny`), rotating refresh tokens with reuse
 * detection, revocation and a `/api/mcp` that checks the bearer token.
 */
export function fakeSteel(options: FakeSteelOptions = {}) {
  const clients = new Map<string, { redirectUris: string[]; scope: string }>()
  const codes = new Map<string, Code>()
  const access = new Map<string, string>()
  const refresh = new Map<
    string,
    { clientId: string; scope: string; used: boolean }
  >()
  const calls: string[] = []
  const revoked: Array<{
    token: string
    hint: string | null
    clientId: string | null
  }> = []
  const authorizations: URL[] = []
  let counter = 0
  const next = (prefix: string) => `${prefix}${++counter}`

  function issue(clientId: string, scope: string) {
    const accessToken = next('stl_at_')
    access.set(accessToken, clientId)
    const withRefresh =
      options.refresh !== false && scope.split(' ').includes('offline_access')
    const refreshToken = withRefresh ? next('stl_rt_') : undefined
    if (refreshToken)
      refresh.set(refreshToken, { clientId, scope, used: false })
    return json(200, {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: options.expiresIn ?? 3600,
      scope,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
    })
  }

  async function token(request: Request): Promise<Response> {
    if (options.tokenStatus)
      return oauthError('server_error', options.tokenStatus)
    const form = new URLSearchParams(await request.text())
    const clientId = form.get('client_id') ?? ''
    if (!clients.has(clientId)) return oauthError('invalid_client', 401)
    if (form.get('resource') !== RESOURCE) return oauthError('invalid_target')
    if (form.get('grant_type') === 'authorization_code') {
      const code = codes.get(form.get('code') ?? '')
      codes.delete(form.get('code') ?? '')
      const verifier = form.get('code_verifier') ?? ''
      const challenge = createHash('sha256')
        .update(verifier)
        .digest('base64url')
      if (
        !code ||
        code.clientId !== clientId ||
        code.redirectUri !== form.get('redirect_uri') ||
        code.challenge !== challenge
      ) {
        return oauthError('invalid_grant')
      }
      return issue(clientId, code.scope)
    }
    if (form.get('grant_type') === 'refresh_token') {
      const row = refresh.get(form.get('refresh_token') ?? '')
      if (!row || row.clientId !== clientId) return oauthError('invalid_grant')
      if (row.used) {
        // Reuse of a rotated token: the whole family dies, like Steel.
        for (const value of refresh.values()) value.used = true
        return oauthError('invalid_grant')
      }
      row.used = true
      return issue(clientId, row.scope)
    }
    return oauthError('unsupported_grant_type')
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.origin !== BASE) throw new TypeError('fetch failed')
    switch (`${request.method} ${url.pathname}`) {
      case 'GET /.well-known/oauth-protected-resource/api/mcp':
        return json(200, {
          resource: RESOURCE,
          authorization_servers: [ISSUER],
          scopes_supported: ['mcp:read', 'mcp:write'],
        })
      case 'GET /.well-known/oauth-authorization-server/api/auth':
        return json(200, METADATA)
      case 'POST /api/auth/oauth2/register': {
        const body = (await request.json()) as Record<string, any>
        const clientId = next('client_')
        clients.set(clientId, {
          redirectUris: body.redirect_uris,
          scope: body.scope,
        })
        return json(201, {
          ...body,
          client_id: clientId,
          client_id_issued_at: 1,
        })
      }
      case 'POST /api/auth/oauth2/token':
        return token(request)
      case 'POST /api/auth/oauth2/revoke': {
        if (options.revokeStatus) return json(options.revokeStatus, {})
        const form = new URLSearchParams(await request.text())
        const value = form.get('token') ?? ''
        revoked.push({
          token: value,
          hint: form.get('token_type_hint'),
          clientId: form.get('client_id'),
        })
        const row = refresh.get(value)
        if (row) row.used = true
        access.delete(value)
        return json(200, null)
      }
      case 'POST /api/mcp': {
        const auth = request.headers.get('authorization') ?? ''
        calls.push(auth)
        if (!access.has(auth.replace(/^Bearer /, ''))) {
          return new Response('unauthorized', { status: 401 })
        }
        const message = (await request.json()) as { id?: number }
        return json(200, {
          jsonrpc: '2.0',
          id: message.id ?? null,
          result: { protocolVersion: '2025-06-18', capabilities: {} },
        })
      }
      case 'GET /api/mcp':
        return new Response(null, { status: 405 })
      default:
        return new Response('not found', { status: 404 })
    }
  }

  const fetch = vi.fn(
    async (input: Request | string | URL, init?: RequestInit) =>
      handle(new Request(input, init)),
  )

  /** Plays the browser: consent, then the redirect to the loopback. */
  async function browse(
    authorizationUrl: string,
    answer: Record<string, string> | 'approve' = 'approve',
  ) {
    const url = new URL(authorizationUrl)
    authorizations.push(url)
    const clientId = url.searchParams.get('client_id') ?? ''
    const redirectUri = url.searchParams.get('redirect_uri') ?? ''
    const client = clients.get(clientId)
    if (!client?.redirectUris.includes(redirectUri)) {
      throw new Error(`bad redirect ${redirectUri}`)
    }
    const back = new URL(redirectUri)
    back.searchParams.set('state', url.searchParams.get('state') ?? '')
    if (answer === 'approve') {
      const code = next('code_')
      codes.set(code, {
        clientId,
        redirectUri,
        challenge: url.searchParams.get('code_challenge') ?? '',
        resource: url.searchParams.get('resource'),
        scope: url.searchParams.get('scope') ?? '',
      })
      back.searchParams.set('code', code)
      back.searchParams.set('iss', ISSUER)
    } else {
      for (const [key, value] of Object.entries(answer)) {
        back.searchParams.set(key, value)
      }
    }
    // The real network, to the CLI's loopback server.
    const response = await globalThis.fetch(back)
    return { status: response.status, html: await response.text() }
  }

  return {
    fetch,
    browse,
    /** `openBrowser` that approves at once. */
    approve: vi.fn(async (url: string) => {
      await browse(url)
      return true
    }),
    clients,
    access,
    refresh,
    calls,
    revoked,
    authorizations,
    /** A stored credential as `steel mcp login` would save it. */
    credential(overrides: Partial<McpCredential> = {}): McpCredential {
      const clientId = next('client_')
      clients.set(clientId, { redirectUris: [], scope: 'mcp:read' })
      const accessToken = next('stl_at_')
      access.set(accessToken, clientId)
      const refreshToken = next('stl_rt_')
      refresh.set(refreshToken, {
        clientId,
        scope: 'mcp:read offline_access',
        used: false,
      })
      return {
        version: 1,
        url: BASE,
        resource: RESOURCE,
        authorizationServer: ISSUER,
        metadata: METADATA,
        client: { client_id: clientId },
        accessToken,
        refreshToken,
        expiresAt: Date.now() + 3_600_000,
        scope: 'mcp:read offline_access',
        savedAt: new Date().toISOString(),
        ...overrides,
      }
    },
  }
}
