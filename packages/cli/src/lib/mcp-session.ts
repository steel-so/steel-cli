import { join } from 'node:path'
import type { CredentialStore } from '../config/credentials.js'
import type { SecretStorage } from '../config/store.js'
import { withFileLock } from './file-lock.js'
import {
  isFresh,
  type McpCredential,
  McpLoginRequiredError,
  parseCredential,
  refreshMcp,
} from './mcp-oauth.js'

type Fetch = typeof globalThis.fetch

export interface McpSessionOptions {
  credentials: CredentialStore
  /** Config dir, for the refresh lock. */
  dir: string
  profile: string
  /** Profile URL; a credential issued for another URL is ignored. */
  url: string
  fetch: Fetch
  now?: () => number
}

/** Key of the MCP credential in the store; `:` never appears in a profile. */
export function mcpCredentialKey(profile: string): string {
  return `mcp:${profile}`
}

/**
 * The MCP OAuth credential of one profile: load, save, refresh. Refreshes
 * run under a lock file and re-read the store first, because the Steel
 * provider rotates refresh tokens and reusing an old one revokes the whole
 * family — two `steel mcp` processes (say, two AI clients) on the same
 * profile must not both spend it.
 */
export class McpSession {
  private credential: McpCredential | undefined
  private refreshing: Promise<string> | undefined
  private readonly key: string
  private readonly lockPath: string
  private readonly now: () => number

  constructor(private readonly options: McpSessionOptions) {
    this.key = mcpCredentialKey(options.profile)
    this.lockPath = join(options.dir, `mcp-refresh-${options.profile}.lock`)
    this.now = options.now ?? Date.now
  }

  async load(): Promise<McpCredential | undefined> {
    const stored = await this.options.credentials.load(this.key)
    const credential = parseCredential(stored?.token)
    this.credential =
      credential && credential.url === this.options.url ? credential : undefined
    return this.credential
  }

  async save(credential: McpCredential): Promise<SecretStorage> {
    this.credential = credential
    return this.options.credentials.save(this.key, JSON.stringify(credential))
  }

  async remove(): Promise<boolean> {
    this.credential = undefined
    return this.options.credentials.remove(this.key)
  }

  /** A valid access token, refreshing first when it is about to expire. */
  async accessToken(): Promise<string> {
    const credential = this.credential ?? (await this.load())
    if (!credential) throw new McpLoginRequiredError('missing')
    if (isFresh(credential, this.now())) return credential.accessToken
    return this.refresh(credential.accessToken)
  }

  /**
   * New access token after `stale` stopped working (expired or a 401).
   * Concurrent callers share one refresh.
   */
  refresh(stale: string): Promise<string> {
    this.refreshing ??= withFileLock(this.lockPath, async () => {
      // Another process may have refreshed while we waited for the lock.
      const latest = await this.load()
      if (!latest) throw new McpLoginRequiredError('missing')
      if (latest.accessToken !== stale && isFresh(latest, this.now())) {
        return latest.accessToken
      }
      const next = await refreshMcp(latest, this.options.fetch, this.now())
      await this.save(next)
      return next.accessToken
    }).finally(() => {
      this.refreshing = undefined
    })
    return this.refreshing
  }

  /**
   * `fetch` with `Authorization: Bearer`, for the MCP transport: refreshes
   * before expiry and, on a 401, refreshes and retries the request once.
   */
  readonly fetch: Fetch = async (input, init) => {
    const send = (token: string) => {
      const headers = new Headers(init?.headers)
      headers.set('authorization', `Bearer ${token}`)
      return this.options.fetch(input, { ...init, headers })
    }
    const token = await this.accessToken()
    const response = await send(token)
    if (response.status !== 401) return response
    await response.body?.cancel()
    return send(await this.refresh(token))
  }
}
