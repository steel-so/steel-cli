import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import type { SecretBackend } from '../src/config/credentials.js'
import type { Deps } from '../src/context.js'
import { runCli } from '../src/main.js'

export class FakeStream extends EventEmitter {
  output = ''
  isTTY: boolean
  columns = 100
  rows = 40

  constructor(tty: boolean) {
    super()
    this.isTTY = tty
  }

  write(chunk: string) {
    this.output += chunk
    return true
  }
}

export function memoryKeychain(): SecretBackend & {
  secrets: Map<string, string>
} {
  const secrets = new Map<string, string>()
  return {
    secrets,
    get: async (profile) => secrets.get(profile),
    set: async (profile, secret) => {
      secrets.set(profile, secret)
    },
    delete: async (profile) => secrets.delete(profile),
  }
}

export function json(status: number, body: unknown, headers = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

export const ok = (data: unknown, status = 200) =>
  json(status, { success: true, statusCode: status, data })

export const fail = (status: number, code: string, message?: string) =>
  json(status, {
    success: false,
    statusCode: status,
    ...(message ? { message } : {}),
    error: { code },
  })

export type Route = Response | Error | ((request: Request) => Response)

export interface HarnessOptions {
  tty?: boolean
  env?: Record<string, string | undefined>
  keychain?: SecretBackend | null
  live?: boolean
  stdin?: string
  files?: Record<string, string>
  configDir?: string
  interrupt?: AbortSignal
}

export function harness(options: HarnessOptions = {}) {
  const dir = options.configDir ?? mkdtempSync(join(tmpdir(), 'steel-cli-'))
  const stdout = new FakeStream(options.tty ?? false)
  const stderr = new FakeStream(options.tty ?? false)
  const routes: Route[] = []
  const requests: Request[] = []
  const fetch = vi.fn(
    async (input: Request | string | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request)
      const next = routes.shift()
      if (!next)
        throw new Error(`unexpected fetch ${request.method} ${request.url}`)
      if (next instanceof Error) throw next
      return typeof next === 'function' ? next(request) : next
    },
  )
  const openBrowser = vi.fn(async (_url: string) => true)
  const keychain =
    options.keychain === undefined ? memoryKeychain() : options.keychain
  const deps: Deps = {
    io: {
      stdout,
      stderr,
      readStdin: async () => options.stdin ?? '',
    },
    env: {
      STEEL_CONFIG_DIR: dir,
      STEEL_NO_UPDATE_NOTIFIER: '1',
      ...options.env,
    },
    fetch: fetch as unknown as typeof globalThis.fetch,
    keychain,
    openBrowser,
    readFile: async (path) => {
      const content = options.files?.[path]
      if (content === undefined) throw new Error(`ENOENT ${path}`)
      return content
    },
    hostname: () => 'test-host',
    sleep: async () => {},
    interrupt: options.interrupt,
    timeZone: 'UTC',
    live: options.live ?? false,
  }
  return {
    dir,
    deps,
    stdout,
    stderr,
    fetch,
    requests,
    openBrowser,
    keychain,
    reply(...responses: Route[]) {
      routes.push(...responses)
    },
    run: (...argv: string[]) => runCli(argv, deps),
    readConfig: async () =>
      JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')),
    out: () => stdout.output,
    err: () => stderr.output,
    outJson: () => JSON.parse(stdout.output),
    errJson: () => JSON.parse(stderr.output.trim().split('\n').at(-1) ?? ''),
  }
}

export const deviceStart = {
  deviceCode: 'dev-123',
  userCode: 'ABCD-EFGH',
  verificationUri: 'https://homologacao.stratustelecom.com.br/device',
  verificationUriComplete:
    'https://homologacao.stratustelecom.com.br/device?code=ABCD-EFGH',
  interval: 5,
  expiresIn: 600,
}

export const deviceToken = {
  token: 'stl_pat_abcdefghijklmnopqrstuvwxyz012345',
  tokenId: 'tok_1',
  expiresAt: '2099-01-15T12:00:00.000Z',
  workspace: { id: 'ws_1', slug: 'demo', name: 'Demo' },
  scopes: ['api:read', 'api:write'],
  modules: ['SERVICE_DESK', 'COMMUNICATION'],
}

export const me = {
  user: { id: 'u1', name: 'Ana Souza', email: 'ana@example.com' },
  workspace: { id: 'ws_1', slug: 'demo', name: 'Demo' },
  scopes: ['api:read'],
  modules: ['CRM'],
  token: { id: 'tok_1', expiresAt: '2099-01-15T12:00:00.000Z' },
}
