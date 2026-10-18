import { describe, expect, it } from 'vitest'
import { fail, harness, me, ok } from './harness.js'

async function loggedIn(options: Parameters<typeof harness>[0] = {}) {
  const h = harness(options)
  await h.keychain?.set('homologacao', 'stl_pat_saved')
  return h
}

describe('steel whoami', () => {
  it('prints the identity as JSON with the token source', async () => {
    const h = await loggedIn()
    h.reply(ok(me))

    expect(await h.run('whoami', '--json')).toBe(0)
    expect(h.outJson()).toEqual({
      ...me,
      profile: 'homologacao',
      url: 'https://homologacao.stratustelecom.com.br',
      tokenSource: 'keychain',
    })
    expect(h.requests[0]?.headers.get('authorization')).toBe(
      'Bearer stl_pat_saved',
    )
    expect(h.requests[0]?.headers.get('user-agent')).toMatch(/^steel-cli\//)
  })

  it('renders a key/value view on a terminal', async () => {
    const h = await loggedIn({ tty: true })
    h.reply(ok(me))

    await h.run('whoami')

    const out = h.out()
    expect(out).toContain('Ana Souza ana@example.com')
    expect(out).toContain('Demo (demo)')
    expect(out).toContain('api:read')
    expect(out).toContain('CRM')
    expect(out).toContain('15/01/2099')
    expect(out).toContain('chaveiro do sistema')
    expect(out).not.toContain('expira em breve')
  })

  it('warns when the token is about to expire and shows the env source', async () => {
    const h = harness({ tty: true, env: { STEEL_TOKEN: 'stl_pat_env' } })
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString()
    h.reply(ok({ ...me, modules: [], token: { id: 't', expiresAt: soon } }))

    await h.run('whoami')

    expect(h.out()).toContain('variável STEEL_TOKEN')
    expect(h.out()).toContain('O token expira em breve')
    expect(h.out()).toContain('Módulos    —')
    expect(h.requests[0]?.headers.get('authorization')).toBe(
      'Bearer stl_pat_env',
    )
  })

  it('shows the credentials file when the token came from it', async () => {
    const h = harness({ tty: true, keychain: null })
    const { CredentialStore, fileBackend } = await import(
      '../src/config/credentials.js'
    )
    await new CredentialStore(null, fileBackend(h.dir)).save('homologacao', 'x')
    h.reply(ok(me))

    await h.run('whoami')

    expect(h.out()).toContain(`${h.dir}/credentials`)
  })

  it('exits 3 when the token is rejected or missing', async () => {
    const h = await loggedIn()
    h.reply(fail(401, 'UNAUTHORIZED'))
    expect(await h.run('whoami')).toBe(3)
    expect(h.errJson().error.code).toBe('UNAUTHORIZED')

    const anonymous = harness({ keychain: null })
    expect(await anonymous.run('whoami')).toBe(3)
    expect(anonymous.errJson().error.code).toBe('NOT_LOGGED_IN')
  })
})

describe('steel logout', () => {
  it('removes the token and the session', async () => {
    const h = await loggedIn({ tty: true })
    const { ConfigStore } = await import('../src/config/store.js')
    const store = new ConfigStore(h.dir)
    await store.update((config) => {
      const profile = config.profiles.homologacao
      if (profile) {
        profile.session = {
          workspace: me.workspace,
          tokenId: 'tok_1',
          expiresAt: me.token.expiresAt,
          scopes: ['api:read'],
          modules: [],
          storage: 'keychain',
          savedAt: '2026-10-01T00:00:00.000Z',
        }
      }
    })

    h.reply(new Response(null, { status: 204 }))

    expect(await h.run('logout')).toBe(0)
    expect(h.out()).toContain('Você saiu do perfil homologacao.')
    expect(h.out()).toContain('Token revogado no Steel.')
    expect(h.out()).not.toContain('Tokens de API')
    expect(h.requests[0]?.method).toBe('DELETE')
    expect(new URL(h.requests[0]?.url ?? '').pathname).toBe(
      '/api/v1/auth/token',
    )
    expect(h.requests[0]?.headers.get('authorization')).toBe(
      'Bearer stl_pat_saved',
    )
    expect(await h.keychain?.get('homologacao')).toBeUndefined()
    expect((await h.readConfig()).profiles.homologacao.session).toBeUndefined()
  })

  it('reports an already invalid token as revoked in JSON', async () => {
    const h = await loggedIn()
    h.reply(fail(401, 'UNAUTHORIZED'))

    expect(await h.run('logout')).toBe(0)
    expect(h.outJson()).toEqual({
      profile: 'homologacao',
      loggedOut: true,
      revoked: true,
    })
  })

  it('still removes the local copy when the revocation fails', async () => {
    const h = await loggedIn({ tty: true })
    h.reply(new TypeError('fetch failed'))

    expect(await h.run('logout')).toBe(0)
    expect(h.out()).toContain('Você saiu do perfil homologacao.')
    expect(h.out()).toContain(
      'Não foi possível revogar o token no Steel (NETWORK_ERROR).',
    )
    expect(h.out()).toContain('Tokens de API')
    expect(await h.keychain?.get('homologacao')).toBeUndefined()
  })

  it('reports a failed revocation as JSON', async () => {
    const h = await loggedIn()
    h.reply(fail(500, 'INTERNAL_SERVER_ERROR'))

    expect(await h.run('logout')).toBe(0)
    expect(h.outJson()).toEqual({
      profile: 'homologacao',
      loggedOut: true,
      revoked: false,
      revokeError: 'INTERNAL_SERVER_ERROR',
    })
  })

  it('reports as JSON when nothing was saved', async () => {
    const h = harness()
    expect(await h.run('logout')).toBe(0)
    expect(h.outJson()).toEqual({ profile: 'homologacao', loggedOut: false })
  })

  it('reminds that STEEL_TOKEN still applies', async () => {
    const h = harness({ tty: true, env: { STEEL_TOKEN: 'stl_pat_env' } })
    await h.run('logout')
    expect(h.out()).toContain('Nenhum login salvo')
    expect(h.out()).toContain('STEEL_TOKEN continua definida')
  })
})
