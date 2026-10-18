import { describe, expect, it } from 'vitest'
import { harness } from './harness.js'

describe('steel profile', () => {
  it('lists the built-in profiles with the current one', async () => {
    const h = harness()
    await h.run('profile', 'list')
    expect(h.outJson()).toEqual([
      {
        name: 'producao',
        url: 'https://app.steel.invalid',
        current: false,
        workspace: null,
        expiresAt: null,
      },
      {
        name: 'homologacao',
        url: 'https://homologacao.stratustelecom.com.br',
        current: true,
        workspace: null,
        expiresAt: null,
      },
    ])
  })

  it('renders a table on a terminal and honours STEEL_PROFILE', async () => {
    const h = harness({ tty: true, env: { STEEL_PROFILE: 'producao' } })
    await h.run('profile', 'list')
    const lines = h.out().split('\n')
    expect(lines[0]).toMatch(/PERFIL\s+URL\s+WORKSPACE/)
    expect(h.out()).toContain('(a definir)')
    expect(lines.find((line) => line.includes('producao'))).toMatch(/^\*/)
  })

  it('adds, uses and replaces profiles', async () => {
    const h = harness({ tty: true })
    expect(
      await h.run('profile', 'add', 'local', '--url', 'http://localhost:3001/'),
    ).toBe(0)
    expect(h.out()).toContain('Perfil local criado: http://localhost:3001')
    expect(h.out()).toContain('steel profile use')

    expect(await h.run('profile', 'use', 'local')).toBe(0)
    expect((await h.readConfig()).currentProfile).toBe('local')

    expect(
      await h.run('profile', 'add', 'local', '--url', 'https://x.example'),
    ).toBe(2)
    expect(h.err()).toContain('já existe')

    await h.keychain?.set('local', 'stl_pat_old')
    expect(
      await h.run(
        'profile',
        'add',
        'local',
        '--url',
        'https://x.example',
        '--force',
        '--use',
      ),
    ).toBe(0)
    expect(h.out()).toContain('Perfil local atualizado')
    expect(await h.keychain?.get('local')).toBeUndefined()
    expect((await h.readConfig()).profiles.local).toEqual({
      url: 'https://x.example',
    })
  })

  it('replies in JSON', async () => {
    const h = harness()
    await h.run(
      'profile',
      'add',
      'prod',
      '--url',
      'https://steel.example',
      '--use',
    )
    expect(h.outJson()).toEqual({
      name: 'prod',
      url: 'https://steel.example',
      current: true,
      builtin: false,
    })
    const second = harness({ configDir: h.dir })
    await second.run('profile', 'use', 'homologacao')
    expect(second.outJson()).toEqual({ currentProfile: 'homologacao' })
  })

  it.each([
    [['profile', 'add', 'Bad Name', '--url', 'https://x.example'], 'inválido'],
    [['profile', 'add', 'ok', '--url', 'http://x.example'], 'URL inválida'],
    [['profile', 'add', 'ok', '--url', 'not a url'], 'URL inválida'],
    [
      ['profile', 'add', 'ok', '--url', 'https://u:p@x.example'],
      'URL inválida',
    ],
    [['profile', 'use', 'nope'], 'não existe'],
    [['--profile', 'nope', 'whoami'], 'não existe'],
  ])('refuses %j', async (argv, message) => {
    const h = harness()
    expect(await h.run(...argv)).toBe(2)
    expect(h.errJson().error.message).toContain(message)
  })

  it('refuses the production placeholder and invalid STEEL_URL', async () => {
    const placeholder = harness()
    expect(await placeholder.run('--profile', 'producao', 'login')).toBe(2)
    expect(placeholder.errJson().error.code).toBe('PROFILE_URL_UNDEFINED')

    const badUrl = harness({ env: { STEEL_URL: 'ftp://x' } })
    expect(await badUrl.run('login')).toBe(2)
    expect(badUrl.errJson().error.message).toBe('URL inválida: ftp://x')
  })

  it('uses STEEL_URL over the profile URL', async () => {
    const h = harness({ env: { STEEL_URL: 'http://127.0.0.1:3001' } })
    h.reply(new TypeError('refused'))
    await h.run('login')
    expect(h.requests[0]?.url).toBe('http://127.0.0.1:3001/api/v1/auth/device')
  })

  it('prints profile names for shell completion', async () => {
    const h = harness()
    await h.run('__complete', 'profiles')
    expect(h.out()).toBe('producao\nhomologacao\n')
    const other = harness()
    await other.run('__complete', 'other')
    expect(other.out()).toBe('')
  })
})
