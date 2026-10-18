import { chmodSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it, vi } from 'vitest'
import { loginFailure } from '../src/commands/mcp.js'
import { CredentialStore, fileBackend } from '../src/config/credentials.js'
import { withFileLock } from '../src/lib/file-lock.js'
import {
  authorizationCode,
  isFresh,
  loginMcp,
  McpAuthorizationError,
  McpLoginCancelledError,
  McpLoginRequiredError,
  McpLoginTimeoutError,
  parseCredential,
  refreshMcp,
  revokeMcp,
  startLoopback,
} from '../src/lib/mcp-oauth.js'
import { McpSession, mcpCredentialKey } from '../src/lib/mcp-session.js'
import { BASE, fakeSteel, ISSUER, METADATA, RESOURCE } from './fake-oauth.js'
import { harness, memoryKeychain } from './harness.js'

const KEY = mcpCredentialKey('homologacao')

const initialize: JSONRPCMessage = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  },
}

function stdio() {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let output = ''
  stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  return { stdin, stdout, output: () => output }
}

/** Harness wired to the fake Steel; `openBrowser` approves by default. */
function setup(
  options: Parameters<typeof harness>[0] = {},
  steel = fakeSteel(),
) {
  const h = harness(options)
  h.deps.fetch = steel.fetch as unknown as typeof globalThis.fetch
  h.deps.openBrowser = steel.approve
  return { h, steel }
}

async function stored(h: ReturnType<typeof harness>) {
  return parseCredential(await h.keychain?.get(KEY))
}

/** Runs `steel mcp`, sends initialize and waits for the answer. */
async function bridgeOnce(h: ReturnType<typeof harness>, ...args: string[]) {
  const io = stdio()
  h.deps.stdio = io
  const run = h.run('mcp', ...args)
  io.stdin.write(`${JSON.stringify(initialize)}\n`)
  await vi.waitFor(() => expect(io.output()).toContain('"id":1'))
  io.stdin.end()
  const code = await run
  return { code, response: JSON.parse(io.output()) }
}

describe('steel mcp login', () => {
  it('runs authorization code + PKCE and stores the tokens', async () => {
    const { h, steel } = setup()

    expect(await h.run('mcp', 'login', '--json')).toBe(0)

    const [client] = [...steel.clients.values()]
    expect(client?.redirectUris).toEqual([
      expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/callback$/),
    ])
    expect(client?.scope).toBe('mcp:read mcp:write offline_access')
    const authorize = steel.authorizations[0]
    expect(authorize?.origin + (authorize?.pathname ?? '')).toBe(
      METADATA.authorization_endpoint,
    )
    expect(Object.fromEntries(authorize?.searchParams ?? [])).toMatchObject({
      response_type: 'code',
      code_challenge_method: 'S256',
      scope: 'mcp:read mcp:write offline_access',
      resource: RESOURCE,
    })
    expect(h.outJson()).toEqual({
      profile: 'homologacao',
      url: BASE,
      scope: 'mcp:read mcp:write offline_access',
      expiresAt: expect.any(String),
      refreshable: true,
      storage: 'keychain',
    })
    const credential = await stored(h)
    expect(credential).toMatchObject({
      url: BASE,
      resource: RESOURCE,
      authorizationServer: ISSUER,
      accessToken: 'stl_at_3',
      refreshToken: 'stl_rt_4',
    })
    expect(h.err()).toContain('Abrimos o navegador')
    // The PAT of `steel login` is untouched.
    expect(await h.keychain?.get('homologacao')).toBeUndefined()
  })

  it('only prints the link with --no-browser and waits for it', async () => {
    const { h, steel } = setup({ tty: true })
    const run = h.run('mcp', 'login', '--no-browser')
    await vi.waitFor(() => expect(h.err()).toContain('/oauth2/authorize?'))
    const url = /https:\S+oauth2\/authorize\?\S+/.exec(h.err())?.[0] as string
    const page = await steel.browse(url)
    expect(page.status).toBe(200)
    expect(page.html).toContain('Você já pode fechar esta aba')

    expect(await run).toBe(0)
    expect(steel.approve).not.toHaveBeenCalled()
    expect(h.err()).toContain('abra no navegador')
    expect(h.out()).toContain('MCP do Steel autorizado no perfil homologacao')
    expect(h.out()).toContain('O token renova sozinho')
  })

  it('warns about the file fallback, a missing refresh token and the env', async () => {
    const { h } = setup(
      { tty: true, keychain: null, env: { STEEL_MCP_TOKEN: 'x' } },
      fakeSteel({ refresh: false }),
    )
    expect(await h.run('mcp', 'login')).toBe(0)
    expect(h.out()).toContain('O Steel não enviou refresh token')
    expect(h.out()).toContain('permissão 600')
    expect(h.out()).toContain('STEEL_MCP_TOKEN está definida')
    const file = JSON.parse(await readFile(join(h.dir, 'credentials'), 'utf8'))
    expect(parseCredential(file[KEY].token)?.refreshToken).toBeUndefined()
    expect((await stat(join(h.dir, 'credentials'))).mode & 0o777).toBe(0o600)
  })

  it('revokes the previous login when logging in again', async () => {
    const { h, steel } = setup()
    const previous = steel.credential()
    await h.keychain?.set(KEY, JSON.stringify(previous))

    expect(await h.run('mcp', 'login', '--json')).toBe(0)
    expect(steel.revoked).toEqual([
      {
        token: previous.refreshToken,
        hint: 'refresh_token',
        clientId: previous.client.client_id,
      },
    ])
  })

  it('reports a refusal in the browser', async () => {
    const { h, steel } = setup()
    h.deps.openBrowser = async (url) => {
      const page = await steel.browse(url, { error: 'access_denied' })
      expect(page.html).toContain('Autorização não concluída')
      return true
    }
    expect(await h.run('mcp', 'login')).toBe(3)
    expect(h.errJson().error.code).toBe('MCP_ACCESS_DENIED')
  })

  it('reports other authorization errors with their description', async () => {
    const { h, steel } = setup()
    h.deps.openBrowser = async (url) => {
      await steel.browse(url, {
        error: 'invalid_scope',
        error_description: 'nope',
      })
      return true
    }
    expect(await h.run('mcp', 'login')).toBe(3)
    expect(h.errJson().error).toMatchObject({
      code: 'MCP_AUTHORIZATION_FAILED',
      hint: 'nope',
    })
  })

  it('exits 130 on Ctrl+C while waiting', async () => {
    const abort = new AbortController()
    const { h } = setup({ interrupt: abort.signal })
    h.deps.openBrowser = async () => {
      setTimeout(() => abort.abort(), 0)
      return true
    }
    expect(await h.run('mcp', 'login')).toBe(130)
    expect(h.errJson().error.code).toBe('CANCELLED')
  })

  it('explains when Steel cannot be reached', async () => {
    const { h } = setup({ env: { STEEL_URL: 'https://offline.example' } })
    expect(await h.run('mcp', 'login')).toBe(1)
    expect(h.errJson().error).toMatchObject({
      code: 'MCP_LOGIN_FAILED',
      message:
        'Não foi possível autorizar o MCP do Steel em https://offline.example.',
    })
  })
})

describe('steel mcp logout', () => {
  it('revokes the refresh token and deletes the credential', async () => {
    const { h, steel } = setup()
    const credential = steel.credential()
    await h.keychain?.set(KEY, JSON.stringify(credential))

    expect(await h.run('mcp', 'logout', '--json')).toBe(0)
    expect(h.outJson()).toEqual({
      profile: 'homologacao',
      loggedOut: true,
      revoked: true,
    })
    expect(steel.revoked[0]?.token).toBe(credential.refreshToken)
    expect(await h.keychain?.get(KEY)).toBeUndefined()
  })

  it('says when there is nothing to remove', async () => {
    const { h } = setup({ tty: true, env: { STEEL_MCP_TOKEN: 'x' } })
    expect(await h.run('mcp', 'logout')).toBe(0)
    expect(h.out()).toContain('Nenhum login do MCP salvo')
    expect(h.out()).toContain('STEEL_MCP_TOKEN continua definida')
  })

  it('still deletes when the revocation fails', async () => {
    const steel = fakeSteel({ revokeStatus: 500 })
    const { h } = setup({ tty: true }, steel)
    await h.keychain?.set(KEY, JSON.stringify(steel.credential()))

    expect(await h.run('mcp', 'logout')).toBe(0)
    expect(h.out()).toContain('Login do MCP removido do perfil homologacao')
    expect(h.out()).toContain(
      'Não foi possível revogar o acesso no Steel (HTTP_500)',
    )
    expect(await h.keychain?.get(KEY)).toBeUndefined()

    await h.keychain?.set(KEY, JSON.stringify(steel.credential()))
    expect(await h.run('mcp', 'logout', '--json')).toBe(0)
    expect(h.out()).toContain('"revokeError": "HTTP_500"')
  })

  it('renders a successful revocation', async () => {
    const { h, steel } = setup({ tty: true })
    await h.keychain?.set(KEY, JSON.stringify(steel.credential()))
    expect(await h.run('mcp', 'logout')).toBe(0)
    expect(h.out()).toContain('Acesso revogado no Steel')
  })
})

describe('steel mcp with the stored credential', () => {
  it('sends the stored access token', async () => {
    const { h, steel } = setup()
    const credential = steel.credential()
    await h.keychain?.set(KEY, JSON.stringify(credential))

    const { code, response } = await bridgeOnce(h)
    expect(code).toBe(0)
    expect(response).toMatchObject({ id: 1, result: {} })
    expect(steel.calls).toEqual([`Bearer ${credential.accessToken}`])
  })

  it('refreshes an access token that is about to expire', async () => {
    const { h, steel } = setup()
    const credential = steel.credential({ expiresAt: Date.now() + 1000 })
    await h.keychain?.set(KEY, JSON.stringify(credential))

    const { code } = await bridgeOnce(h)
    expect(code).toBe(0)
    const next = await stored(h)
    expect(next?.accessToken).not.toBe(credential.accessToken)
    expect(next?.refreshToken).not.toBe(credential.refreshToken)
    expect(steel.calls).toEqual([`Bearer ${next?.accessToken}`])
  })

  it('refreshes and retries once on a 401', async () => {
    const { h, steel } = setup()
    const credential = steel.credential()
    await h.keychain?.set(KEY, JSON.stringify(credential))
    steel.access.delete(credential.accessToken) // revoked server-side

    const { code, response } = await bridgeOnce(h)
    expect(code).toBe(0)
    expect(response.result).toBeDefined()
    const next = await stored(h)
    expect(steel.calls).toEqual([
      `Bearer ${credential.accessToken}`,
      `Bearer ${next?.accessToken}`,
    ])
  })

  it('tells the client to log in again when the refresh is refused', async () => {
    const { h, steel } = setup()
    const credential = steel.credential()
    await h.keychain?.set(KEY, JSON.stringify(credential))
    steel.access.delete(credential.accessToken)
    // biome-ignore lint/style/noNonNullAssertion: set by credential()
    steel.refresh.get(credential.refreshToken!)!.used = true

    const { code, response } = await bridgeOnce(h)
    expect(code).toBe(0)
    expect(response.error.message).toContain(
      'O login do MCP do Steel expirou ou foi revogado.',
    )
    expect(h.errJson().error).toMatchObject({
      code: 'MCP_LOGIN_REQUIRED',
      hint: expect.stringContaining('steel mcp login --profile homologacao'),
    })
  })

  it('fails at start when the stored grant is gone and login is off', async () => {
    const { h, steel } = setup()
    const credential = steel.credential({ expiresAt: Date.now() - 1 })
    // biome-ignore lint/style/noNonNullAssertion: set by credential()
    steel.refresh.get(credential.refreshToken!)!.used = true
    await h.keychain?.set(KEY, JSON.stringify(credential))
    h.deps.stdio = stdio()

    expect(await h.run('mcp', '--no-login')).toBe(3)
    expect(h.errJson().error).toMatchObject({
      code: 'MCP_LOGIN_REQUIRED',
      message: expect.stringContaining('expirou ou foi revogado'),
    })
  })

  it('reports a refresh that cannot reach Steel', async () => {
    const { h, steel } = setup()
    await h.keychain?.set(
      KEY,
      JSON.stringify(steel.credential({ expiresAt: Date.now() - 1 })),
    )
    h.deps.fetch = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof globalThis.fetch
    h.deps.stdio = stdio()

    expect(await h.run('mcp')).toBe(1)
    expect(h.errJson().error.code).toBe('MCP_REFRESH_FAILED')
  })

  it('lets STEEL_MCP_TOKEN override the stored credential', async () => {
    const { h, steel } = setup({ env: { STEEL_MCP_TOKEN: 'stl_at_env' } })
    steel.access.set('stl_at_env', 'env')
    await h.keychain?.set(KEY, JSON.stringify(steel.credential()))

    await bridgeOnce(h)
    expect(steel.calls).toEqual(['Bearer stl_at_env'])
  })

  it('ignores a credential issued for another URL', async () => {
    const { h, steel } = setup()
    await h.keychain?.set(
      KEY,
      JSON.stringify(steel.credential({ url: 'https://other.example' })),
    )
    h.deps.stdio = stdio()
    expect(await h.run('mcp', '--no-login')).toBe(3)
    expect(h.errJson().error.message).toContain('ainda não foi autorizado')
  })
})

describe('steel mcp without any credential', () => {
  it('logs in through the browser first, writing only to stderr', async () => {
    const { h, steel } = setup()

    const { code, response } = await bridgeOnce(h)
    expect(code).toBe(0)
    expect(response.id).toBe(1)
    expect(steel.approve).toHaveBeenCalledTimes(1)
    expect(h.err()).toContain('vamos autorizar pelo navegador')
    expect(h.err()).toContain('MCP do Steel autorizado.')
    expect(h.out()).toBe('')
    expect(steel.calls).toEqual([`Bearer ${(await stored(h))?.accessToken}`])
  })

  it('does not wait when no browser opens', async () => {
    const { h, steel } = setup()
    h.deps.openBrowser = vi.fn(async () => false)
    h.deps.stdio = stdio()

    expect(await h.run('mcp')).toBe(3)
    expect(h.errJson().error).toMatchObject({
      code: 'MCP_LOGIN_REQUIRED',
      hint: 'Rode `steel mcp login --profile homologacao` num terminal ou defina STEEL_MCP_TOKEN.',
    })
    expect(steel.authorizations).toHaveLength(0)
  })

  it.each([
    [{ CI: 'true' }, []],
    [{ STEEL_MCP_NO_LOGIN: '1' }, []],
    [{}, ['--no-login']],
  ])('never opens the browser with %o %o', async (env, args) => {
    const { h, steel } = setup({ env })
    h.deps.stdio = stdio()
    expect(await h.run('mcp', ...args)).toBe(3)
    expect(steel.approve).not.toHaveBeenCalled()
  })
})

describe('loginFailure', () => {
  it('explains a login that timed out', () => {
    expect(loginFailure(new McpLoginTimeoutError(), BASE)).toMatchObject({
      code: 'MCP_LOGIN_TIMEOUT',
      exitCode: 3,
    })
  })
})

describe('McpSession', () => {
  function sessions() {
    const steel = fakeSteel()
    const dir = mkdtempSync(join(tmpdir(), 'steel-mcp-'))
    const keychain = memoryKeychain()
    const make = () =>
      new McpSession({
        credentials: new CredentialStore(keychain, fileBackend(dir)),
        dir,
        profile: 'homologacao',
        url: BASE,
        fetch: steel.fetch as unknown as typeof globalThis.fetch,
      })
    return { steel, keychain, make }
  }

  it('adopts a refresh another process already made', async () => {
    const { steel, keychain, make } = sessions()
    const credential = steel.credential()
    await keychain.set(KEY, JSON.stringify(credential))
    const a = make()
    const b = make()
    await b.load()

    const fromA = await a.refresh(credential.accessToken)
    const fromB = await b.refresh(credential.accessToken)
    expect(fromB).toBe(fromA)
    const refreshes = steel.fetch.mock.calls.filter(([input]) =>
      String(input instanceof Request ? input.url : input).endsWith('/token'),
    )
    expect(refreshes).toHaveLength(1)
  })

  it('shares one refresh between concurrent callers', async () => {
    const { steel, keychain, make } = sessions()
    const credential = steel.credential()
    await keychain.set(KEY, JSON.stringify(credential))
    const session = make()
    const [x, y] = await Promise.all([
      session.refresh(credential.accessToken),
      session.refresh(credential.accessToken),
    ])
    expect(x).toBe(y)
  })

  it('needs a login when nothing is stored', async () => {
    const { make } = sessions()
    await expect(make().accessToken()).rejects.toBeInstanceOf(
      McpLoginRequiredError,
    )
    await expect(make().refresh('x')).rejects.toMatchObject({
      reason: 'missing',
    })
  })
})

describe('mcp-oauth helpers', () => {
  it('parses only well-formed credentials', () => {
    expect(parseCredential(undefined)).toBeUndefined()
    expect(parseCredential('not json')).toBeUndefined()
    expect(parseCredential('[]')).toBeUndefined()
    expect(parseCredential(JSON.stringify({ version: 1 }))).toBeUndefined()
    const valid = fakeSteel().credential()
    expect(parseCredential(JSON.stringify(valid))).toEqual(valid)
  })

  it('treats a token without expiry as fresh', () => {
    const credential = fakeSteel().credential({ expiresAt: undefined })
    expect(isFresh(credential, Date.now())).toBe(true)
  })

  it('checks the issuer of the authorization response (RFC 9207)', () => {
    const params = (query: string) => new URLSearchParams(query)
    expect(authorizationCode(params(`code=c&iss=${ISSUER}`), METADATA)).toBe(
      'c',
    )
    expect(() => authorizationCode(params('code=c'), METADATA)).toThrow(
      'invalid_issuer',
    )
    expect(() =>
      authorizationCode(params('code=c&iss=https://evil.example'), METADATA),
    ).toThrow(McpAuthorizationError)
    const noIss = {
      ...METADATA,
      authorization_response_iss_parameter_supported: false,
    }
    expect(authorizationCode(params('code=c'), noIss)).toBe('c')
    expect(() => authorizationCode(params(`iss=${ISSUER}`), METADATA)).toThrow(
      'no code',
    )
    expect(() =>
      authorizationCode(params('error=access_denied'), METADATA),
    ).toThrow('access_denied')
  })

  it('times out and cancels the wait for the browser', async () => {
    const steel = fakeSteel()
    const base = {
      url: BASE,
      fetch: steel.fetch as unknown as typeof globalThis.fetch,
      openBrowser: async () => true,
      onAuthorizationUrl: () => {},
      clientName: 'test',
    }
    await expect(loginMcp({ ...base, timeoutMs: 10 })).rejects.toBeInstanceOf(
      McpLoginTimeoutError,
    )
    await expect(
      loginMcp({ ...base, signal: AbortSignal.abort() }),
    ).rejects.toBeInstanceOf(McpLoginCancelledError)
  })

  it('fails discovery without authorization server metadata', async () => {
    const fetch = (async () =>
      new Response('nope', { status: 404 })) as typeof globalThis.fetch
    await expect(
      loginMcp({
        url: BASE,
        fetch,
        openBrowser: async () => true,
        onAuthorizationUrl: () => {},
        clientName: 'test',
      }),
    ).rejects.toThrow('No OAuth authorization server metadata')
  })

  it('answers stray requests on the loopback without ending the wait', async () => {
    const loopback = await startLoopback('right')
    try {
      const base = loopback.redirectUri.replace('/callback', '')
      expect((await fetch(`${base}/other`)).status).toBe(404)
      expect((await fetch(`${loopback.redirectUri}?state=wrong`)).status).toBe(
        400,
      )
      const ok = await fetch(`${loopback.redirectUri}?state=right&code=c`)
      expect(ok.status).toBe(200)
      expect((await loopback.callback).get('code')).toBe('c')
    } finally {
      await loopback.close()
    }
  })

  it('needs a refresh token to refresh, and passes other errors on', async () => {
    const steel = fakeSteel()
    const fetch = steel.fetch as unknown as typeof globalThis.fetch
    await expect(
      refreshMcp(
        steel.credential({ refreshToken: undefined }),
        fetch,
        Date.now(),
      ),
    ).rejects.toBeInstanceOf(McpLoginRequiredError)
    const down = fakeSteel({ tokenStatus: 503 })
    await expect(
      refreshMcp(
        down.credential(),
        down.fetch as unknown as typeof globalThis.fetch,
        Date.now(),
      ),
    ).rejects.toThrow()
  })

  it('revokes the access token when there is no refresh token', async () => {
    const steel = fakeSteel()
    const fetch = steel.fetch as unknown as typeof globalThis.fetch
    const credential = steel.credential({
      refreshToken: undefined,
      client: { client_id: 'c', client_secret: 's' },
    })
    expect(await revokeMcp(credential, fetch)).toEqual({ ok: true })
    expect(steel.revoked[0]).toMatchObject({
      token: credential.accessToken,
      hint: 'access_token',
    })
    const body = await (steel.fetch.mock.calls[0]?.[1]?.body as string)
    expect(body).toContain('client_secret=s')
  })

  it('reports why a revocation could not happen', async () => {
    const steel = fakeSteel()
    const credential = steel.credential()
    const failing = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof globalThis.fetch
    expect(await revokeMcp(credential, failing)).toEqual({
      ok: false,
      reason: 'NETWORK_ERROR',
    })
    const { revocation_endpoint: _, ...metadata } = METADATA
    expect(await revokeMcp({ ...credential, metadata }, failing)).toEqual({
      ok: false,
      reason: 'NO_REVOCATION_ENDPOINT',
    })
  })
})

describe('withFileLock', () => {
  const lockPath = () =>
    join(mkdtempSync(join(tmpdir(), 'steel-lock-')), 'nested', 'x.lock')

  it('runs one holder at a time and removes the lock', async () => {
    const path = lockPath()
    const order: string[] = []
    const slow = withFileLock(
      path,
      async () => {
        order.push('a:start')
        await new Promise((resolve) => setTimeout(resolve, 30))
        order.push('a:end')
      },
      { retryMs: 5 },
    )
    await new Promise((resolve) => setTimeout(resolve, 5))
    await withFileLock(
      path,
      async () => {
        order.push('b')
      },
      { retryMs: 5 },
    )
    await slow
    expect(order).toEqual(['a:start', 'a:end', 'b'])
    await expect(stat(path)).rejects.toThrow()
  })

  it('breaks a stale lock and runs anyway after the timeout', async () => {
    const path = lockPath()
    await withFileLock(path, async () => {})
    writeFileSync(path, '')
    const old = new Date(Date.now() - 60_000)
    utimesSync(path, old, old)
    expect(await withFileLock(path, async () => 'stale')).toBe('stale')

    writeFileSync(path, '')
    expect(
      await withFileLock(path, async () => 'late', {
        timeoutMs: 20,
        retryMs: 5,
      }),
    ).toBe('late')
    // Not ours: left for its owner.
    expect((await stat(path)).isFile()).toBe(true)
  })

  it('rethrows unexpected errors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'steel-lock-'))
    chmodSync(dir, 0o500)
    try {
      await expect(
        withFileLock(join(dir, 'x.lock'), async () => {}),
      ).rejects.toMatchObject({ code: 'EACCES' })
    } finally {
      chmodSync(dir, 0o700)
    }
  })
})
