import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  refreshAuthorization,
  registerClient,
  startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js'
import {
  InvalidClientError,
  InvalidGrantError,
  UnauthorizedClientError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type {
  AuthorizationServerMetadata,
  OAuthClientInformation,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'

type Fetch = typeof globalThis.fetch

/**
 * Scopes the CLI asks for. The consent page lets the user narrow them;
 * `offline_access` is what makes the Steel provider issue a refresh token
 * (ADR 0033: access 1 h, refresh 30 days, rotated on every use).
 */
export const MCP_OAUTH_SCOPE = 'mcp:read mcp:write offline_access'

/** Refresh this long before the access token expires. */
export const REFRESH_MARGIN_MS = 60_000

/** How long `steel mcp login` waits for the browser. */
export const LOGIN_TIMEOUT_MS = 5 * 60_000

/** Path of the loopback redirect (RFC 8252 §7.3); the port varies. */
export const CALLBACK_PATH = '/callback'

/**
 * What the CLI keeps per profile for the MCP: the OAuth tokens plus what is
 * needed to refresh and revoke them without discovering again. Stored as
 * JSON in the same credential store as the `stl_pat_` token.
 */
export interface McpCredential {
  version: 1
  /** Profile URL the tokens were issued for; another URL means log in again. */
  url: string
  /** The protected resource (`<url>/api/mcp`), sent as `resource`. */
  resource: string
  authorizationServer: string
  metadata: AuthorizationServerMetadata
  client: OAuthClientInformation
  accessToken: string
  refreshToken?: string
  /** Epoch ms; absent when the server did not say. */
  expiresAt?: number
  scope?: string
  savedAt: string
}

/** No usable MCP credential: the user must run `steel mcp login`. */
export class McpLoginRequiredError extends Error {
  constructor(readonly reason: 'missing' | 'expired') {
    super(
      reason === 'missing'
        ? 'No MCP OAuth credential for this profile'
        : 'The MCP OAuth credential can no longer be refreshed',
    )
    this.name = 'McpLoginRequiredError'
  }
}

/** The user (or the server) refused the authorization in the browser. */
export class McpAuthorizationError extends Error {
  constructor(
    readonly error: string,
    readonly description?: string,
  ) {
    super(description ? `${error}: ${description}` : error)
    this.name = 'McpAuthorizationError'
  }
}

/** Nobody came back to the loopback redirect in time. */
export class McpLoginTimeoutError extends Error {
  constructor() {
    super('Timed out waiting for the browser')
    this.name = 'McpLoginTimeoutError'
  }
}

/** Ctrl+C while waiting for the browser. */
export class McpLoginCancelledError extends Error {
  constructor() {
    super('Login cancelled')
    this.name = 'McpLoginCancelledError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reads a stored credential; `undefined` when it is missing or malformed. */
export function parseCredential(
  raw: string | undefined,
): McpCredential | undefined {
  if (!raw) return undefined
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.url !== 'string' ||
    typeof value.resource !== 'string' ||
    typeof value.authorizationServer !== 'string' ||
    !isRecord(value.metadata) ||
    !isRecord(value.client) ||
    typeof value.client.client_id !== 'string' ||
    typeof value.accessToken !== 'string'
  ) {
    return undefined
  }
  return value as unknown as McpCredential
}

/** Whether the access token is still good for at least `REFRESH_MARGIN_MS`. */
export function isFresh(credential: McpCredential, now: number): boolean {
  return (
    credential.expiresAt === undefined ||
    credential.expiresAt - now > REFRESH_MARGIN_MS
  )
}

/** Tokens from the server → the stored shape. */
export function toCredential(
  base: Pick<
    McpCredential,
    'url' | 'resource' | 'authorizationServer' | 'metadata' | 'client'
  >,
  tokens: OAuthTokens,
  now: number,
): McpCredential {
  return {
    version: 1,
    ...base,
    accessToken: tokens.access_token,
    ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    ...(typeof tokens.expires_in === 'number'
      ? { expiresAt: now + tokens.expires_in * 1000 }
      : {}),
    ...(tokens.scope ? { scope: tokens.scope } : {}),
    savedAt: new Date(now).toISOString(),
  }
}

export interface McpServerInfo {
  resource: string
  authorizationServer: string
  metadata: AuthorizationServerMetadata
}

/**
 * RFC 9728 + RFC 8414 discovery from the profile URL: the protected
 * resource `<url>/api/mcp` names its authorization server
 * (`<url>/api/auth` on Steel), whose metadata has the endpoints.
 */
export async function discoverMcpServer(
  url: string,
  fetch: Fetch,
): Promise<McpServerInfo> {
  const mcpUrl = `${url}/api/mcp`
  const info = await discoverOAuthServerInfo(mcpUrl, { fetchFn: fetch })
  if (!info.authorizationServerMetadata) {
    throw new Error(
      `No OAuth authorization server metadata at ${info.authorizationServerUrl}`,
    )
  }
  return {
    resource: info.resourceMetadata?.resource ?? mcpUrl,
    authorizationServer: info.authorizationServerUrl,
    metadata: info.authorizationServerMetadata,
  }
}

export interface Loopback {
  redirectUri: string
  /** Resolves with the callback query whose `state` matches. */
  callback: Promise<URLSearchParams>
  close(): Promise<void>
}

const PAGE_STYLE =
  'font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5'

/** Fixed pages: nothing from the query is echoed back. */
function page(title: string, body: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="${PAGE_STYLE}"><h1>${title}</h1><p>${body}</p></body></html>`
}

const SUCCESS_PAGE = page(
  'Steel CLI conectado',
  'O MCP do Steel foi autorizado. Você já pode fechar esta aba e voltar ao terminal.',
)
const DENIED_PAGE = page(
  'Autorização não concluída',
  'O Steel não autorizou o acesso. Volte ao terminal para ver o motivo.',
)
const UNKNOWN_PAGE = page(
  'Link inválido',
  'Este retorno não corresponde a um login em andamento do Steel CLI.',
)

/**
 * A one-shot HTTP server on 127.0.0.1 (random port) that receives the
 * authorization response. Callbacks with another `state` are answered with
 * an error page and ignored, so a stray request cannot end the login.
 */
export async function startLoopback(state: string): Promise<Loopback> {
  let deliver: (params: URLSearchParams) => void = () => {}
  const callback = new Promise<URLSearchParams>((resolve) => {
    deliver = resolve
  })
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const html = (status: number, body: string) => {
      response.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'close',
      })
      response.end(body)
    }
    if (request.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
      html(404, UNKNOWN_PAGE)
      return
    }
    if (url.searchParams.get('state') !== state) {
      html(400, UNKNOWN_PAGE)
      return
    }
    html(200, url.searchParams.has('code') ? SUCCESS_PAGE : DENIED_PAGE)
    deliver(url.searchParams)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const { port } = server.address() as AddressInfo
  return {
    redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
    callback,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

/** Waits for `promise`, unless the timeout fires or the signal aborts first. */
function waitFor<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new McpLoginCancelledError())
      return
    }
    const timer = setTimeout(
      () => finish(() => reject(new McpLoginTimeoutError())),
      timeoutMs,
    )
    const onAbort = () => finish(() => reject(new McpLoginCancelledError()))
    function finish(settle: () => void) {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      settle()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    promise.then((value) => finish(() => resolve(value)))
  })
}

/** Checks the authorization response: error, issuer (RFC 9207) and code. */
export function authorizationCode(
  params: URLSearchParams,
  metadata: AuthorizationServerMetadata,
): string {
  const error = params.get('error')
  if (error) {
    throw new McpAuthorizationError(
      error,
      params.get('error_description') ?? undefined,
    )
  }
  const iss = params.get('iss')
  const issRequired =
    'authorization_response_iss_parameter_supported' in metadata &&
    metadata.authorization_response_iss_parameter_supported === true
  if ((iss !== null || issRequired) && iss !== metadata.issuer) {
    throw new McpAuthorizationError(
      'invalid_issuer',
      'the authorization response came from another issuer',
    )
  }
  const code = params.get('code')
  if (!code) throw new McpAuthorizationError('invalid_request', 'no code')
  return code
}

export interface McpLoginOptions {
  url: string
  fetch: Fetch
  /** Opens the authorization URL; `false` when no browser could be used. */
  openBrowser(url: string): Promise<boolean>
  /** Called with the authorization URL before the browser opens. */
  onAuthorizationUrl(url: string, opened: boolean): void
  clientName: string
  signal?: AbortSignal
  timeoutMs?: number
  now?: () => number
}

/**
 * OAuth 2.1 authorization code + PKCE against the Steel MCP authorization
 * server: discovery, dynamic registration of a public client with a
 * loopback redirect, browser consent, code exchange.
 */
export async function loginMcp(
  options: McpLoginOptions,
): Promise<McpCredential> {
  const now = options.now ?? Date.now
  const server = await discoverMcpServer(options.url, options.fetch)
  const state = randomBytes(16).toString('base64url')
  const loopback = await startLoopback(state)
  try {
    const client = await registerClient(server.authorizationServer, {
      metadata: server.metadata,
      clientMetadata: {
        client_name: options.clientName,
        redirect_uris: [loopback.redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      scope: MCP_OAUTH_SCOPE,
      fetchFn: options.fetch,
    })
    const { authorizationUrl, codeVerifier } = await startAuthorization(
      server.authorizationServer,
      {
        metadata: server.metadata,
        clientInformation: client,
        redirectUrl: loopback.redirectUri,
        scope: MCP_OAUTH_SCOPE,
        state,
        resource: new URL(server.resource),
      },
    )
    const opened = await options.openBrowser(authorizationUrl.toString())
    options.onAuthorizationUrl(authorizationUrl.toString(), opened)
    const params = await waitFor(
      loopback.callback,
      options.timeoutMs ?? LOGIN_TIMEOUT_MS,
      options.signal,
    )
    const code = authorizationCode(params, server.metadata)
    const tokens = await exchangeAuthorization(server.authorizationServer, {
      metadata: server.metadata,
      clientInformation: client,
      authorizationCode: code,
      codeVerifier,
      redirectUri: loopback.redirectUri,
      resource: new URL(server.resource),
      fetchFn: options.fetch,
    })
    const clientInfo: OAuthClientInformation = {
      client_id: client.client_id,
      ...(client.client_secret ? { client_secret: client.client_secret } : {}),
    }
    return toCredential(
      { url: options.url, ...server, client: clientInfo },
      tokens,
      now(),
    )
  } finally {
    await loopback.close()
  }
}

/**
 * Trades the refresh token for new tokens. The Steel provider rotates the
 * refresh token, so the result must be saved before anyone refreshes again.
 * Throws `McpLoginRequiredError` when the grant is gone for good.
 */
export async function refreshMcp(
  credential: McpCredential,
  fetch: Fetch,
  now: number,
): Promise<McpCredential> {
  if (!credential.refreshToken) throw new McpLoginRequiredError('expired')
  let tokens: OAuthTokens
  try {
    tokens = await refreshAuthorization(credential.authorizationServer, {
      metadata: credential.metadata,
      clientInformation: credential.client,
      refreshToken: credential.refreshToken,
      resource: new URL(credential.resource),
      fetchFn: fetch,
    })
  } catch (error) {
    if (
      error instanceof InvalidGrantError ||
      error instanceof InvalidClientError ||
      error instanceof UnauthorizedClientError
    ) {
      throw new McpLoginRequiredError('expired')
    }
    throw error
  }
  return toCredential(credential, tokens, now)
}

export type RevokeResult = { ok: true } | { ok: false; reason: string }

/**
 * RFC 7009 revocation. The refresh token goes first: revoking it also
 * deletes its access tokens on Steel. Never throws.
 */
export async function revokeMcp(
  credential: McpCredential,
  fetch: Fetch,
): Promise<RevokeResult> {
  // OIDC discovery metadata has no `revocation_endpoint` in the SDK types.
  const endpoint = (credential.metadata as { revocation_endpoint?: unknown })
    .revocation_endpoint
  if (typeof endpoint !== 'string') {
    return { ok: false, reason: 'NO_REVOCATION_ENDPOINT' }
  }
  const [token, hint] = credential.refreshToken
    ? [credential.refreshToken, 'refresh_token']
    : [credential.accessToken, 'access_token']
  const body = new URLSearchParams({
    token,
    token_type_hint: hint,
    client_id: credential.client.client_id,
  })
  if (credential.client.client_secret) {
    body.set('client_secret', credential.client.client_secret)
  }
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: body.toString(),
    })
    await response.body?.cancel()
    return response.ok
      ? { ok: true }
      : { ok: false, reason: `HTTP_${response.status}` }
  } catch {
    return { ok: false, reason: 'NETWORK_ERROR' }
  }
}
