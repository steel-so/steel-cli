import type { Readable, Writable } from 'node:stream'
import { createSteelClient, type SteelClient } from '@steel-so/sdk'
import { renderToString } from 'ink'
import type { ReactNode } from 'react'
import {
  CredentialStore,
  fileBackend,
  type SecretBackend,
} from './config/credentials.js'
import { configDir, type Env } from './config/paths.js'
import { isPlaceholderUrl, normalizeBaseUrl } from './config/profiles.js'
import { ConfigStore, type ProfileConfig } from './config/store.js'
import { CliError, EXIT, notLoggedIn, usageError } from './errors.js'
import { ErrorMessage } from './ui/components.js'
import { VERSION } from './version.js'

export interface OutputStream {
  write(chunk: string): unknown
  isTTY?: boolean
  columns?: number
}

export interface IO {
  stdout: OutputStream
  stderr: OutputStream
  /** Reads all of stdin (for `-d @-`). */
  readStdin(): Promise<string>
}

/** Everything that touches the outside world, injected for tests. */
export interface Deps {
  io: IO
  env: Env
  fetch: typeof globalThis.fetch
  /** `null` disables the keychain (tests, STEEL_NO_KEYCHAIN). */
  keychain: SecretBackend | null
  openBrowser(url: string): Promise<boolean>
  readFile(path: string): Promise<string>
  hostname(): string
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Signal that aborts long waits (Ctrl+C). */
  interrupt?: AbortSignal
  /** IANA zone for dates; system zone when undefined. */
  timeZone?: string
  /** Live (Ink) rendering; off in tests and outside a TTY. */
  live?: boolean
  /** Raw process streams, for protocols over stdio (`steel mcp`). */
  stdio?: { stdin: Readable; stdout: Writable }
}

export interface GlobalOptions {
  json?: boolean
  profile?: string
  color?: boolean
}

export interface Target {
  profileName: string
  url: string
  profile: ProfileConfig
}

export type TokenSource = 'env' | 'keychain' | 'file'

export interface AuthTarget extends Target {
  token: string
  tokenSource: TokenSource
}

export class Context {
  readonly config: ConfigStore
  readonly credentials: CredentialStore
  readonly credentialsPath: string
  /** Machine output: `--json` or stdout is not a terminal. */
  readonly json: boolean

  constructor(
    readonly deps: Deps,
    readonly options: GlobalOptions,
  ) {
    const dir = configDir(deps.env)
    const file = fileBackend(dir)
    this.config = new ConfigStore(dir)
    this.credentials = new CredentialStore(deps.keychain, file)
    this.credentialsPath = file.path
    this.json = Boolean(options.json) || !deps.io.stdout.isTTY
  }

  get io(): IO {
    return this.deps.io
  }

  get env(): Env {
    return this.deps.env
  }

  get live(): boolean {
    return Boolean(this.deps.live) && !this.json
  }

  /** Profile name and URL, after `--profile`, STEEL_PROFILE and STEEL_URL. */
  async target(): Promise<Target> {
    const config = await this.config.read()
    const profileName =
      this.options.profile ?? this.env.STEEL_PROFILE ?? config.currentProfile
    const profile = config.profiles[profileName]
    if (!profile) {
      throw usageError(
        `O perfil “${profileName}” não existe.`,
        'Veja os perfis com `steel profile list` ou crie um com `steel profile add`.',
      )
    }
    const rawUrl = this.env.STEEL_URL ?? profile.url
    const url = normalizeBaseUrl(rawUrl)
    if (!url) {
      throw usageError(
        `URL inválida: ${rawUrl}`,
        'Use https:// (http:// só em localhost).',
      )
    }
    if (isPlaceholderUrl(url)) {
      throw new CliError('A URL de produção do Steel ainda não foi definida.', {
        hint: 'Use `--profile homologacao`, defina STEEL_URL ou rode `steel profile add producao --url <url> --force`.',
        code: 'PROFILE_URL_UNDEFINED',
        exitCode: EXIT.USAGE,
      })
    }
    return { profileName, url, profile }
  }

  /** Target plus a token: STEEL_TOKEN, then the keychain, then the file. */
  async authTarget(): Promise<AuthTarget> {
    const target = await this.target()
    if (this.env.STEEL_TOKEN) {
      return { ...target, token: this.env.STEEL_TOKEN, tokenSource: 'env' }
    }
    const stored = await this.credentials.load(target.profileName)
    if (!stored) throw notLoggedIn(target.profileName)
    return { ...target, token: stored.token, tokenSource: stored.storage }
  }

  client(target: Target, token?: string): SteelClient {
    return createSteelClient({
      baseUrl: target.url,
      token,
      fetch: this.deps.fetch,
      userAgent: `steel-cli/${VERSION} (${process.platform}; node ${process.versions.node})`,
    })
  }

  render(node: ReactNode, stream: OutputStream = this.io.stdout): void {
    stream.write(
      `${renderToString(node, { columns: stream.columns || 100 })}\n`,
    )
  }

  printJson(value: unknown): void {
    this.io.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
  }

  printError(error: CliError): void {
    if (this.options.json || !this.io.stderr.isTTY) {
      this.io.stderr.write(
        `${JSON.stringify({
          error: {
            code: error.code,
            message: error.message,
            ...(error.hint ? { hint: error.hint } : {}),
          },
        })}\n`,
      )
      return
    }
    this.render(
      <ErrorMessage message={error.message} hint={error.hint} />,
      this.io.stderr,
    )
  }
}
