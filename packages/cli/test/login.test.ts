import { describe, expect, it } from 'vitest'
import {
  deviceStart,
  deviceToken,
  fail,
  harness,
  memoryKeychain,
  ok,
} from './harness.js'

describe('steel login', () => {
  it('runs the device flow and stores the token (JSON mode)', async () => {
    const h = harness()
    h.reply(
      ok(deviceStart),
      fail(428, 'AUTHORIZATION_PENDING'),
      ok(deviceToken),
    )

    const code = await h.run('login')

    expect(code).toBe(0)
    expect(h.outJson()).toEqual({
      profile: 'homologacao',
      url: 'https://homologacao.stratustelecom.com.br',
      workspace: deviceToken.workspace,
      tokenId: 'tok_1',
      expiresAt: deviceToken.expiresAt,
      scopes: deviceToken.scopes,
      modules: deviceToken.modules,
      storage: 'keychain',
    })
    expect(h.err()).toContain(
      `abra ${deviceStart.verificationUriComplete} e confirme o código ABCD-EFGH`,
    )
    expect(h.openBrowser).not.toHaveBeenCalled()
    await expect(h.keychain?.get('homologacao')).resolves.toBe(
      deviceToken.token,
    )

    const start = h.requests[0]
    expect(start?.url).toBe(
      'https://homologacao.stratustelecom.com.br/api/v1/auth/device',
    )
    expect(await start?.json()).toEqual({
      clientName: 'Steel CLI',
      deviceName: 'test-host',
    })
    const config = await h.readConfig()
    expect(config.profiles.homologacao.session).toMatchObject({
      tokenId: 'tok_1',
      storage: 'keychain',
      workspace: deviceToken.workspace,
    })
    expect(JSON.stringify(config)).not.toContain(deviceToken.token)
  })

  it('opens the browser and prints a styled summary on a terminal', async () => {
    const h = harness({ tty: true, keychain: null })
    h.reply(ok(deviceStart), ok(deviceToken))

    const code = await h.run('login', '--profile', 'homologacao')

    expect(code).toBe(0)
    expect(h.openBrowser).toHaveBeenCalledWith(
      deviceStart.verificationUriComplete,
    )
    const out = h.out()
    expect(out).toContain('Conectado ao workspace Demo (demo)')
    expect(out).toContain('ServiceDesk, Comunicação')
    expect(out).toContain('15/01/2099')
    expect(out).toContain('permissão 600')
  })

  it('skips the browser with --no-browser', async () => {
    const h = harness({ tty: true })
    h.reply(ok(deviceStart), ok(deviceToken))

    await h.run('login', '--no-browser')

    expect(h.openBrowser).not.toHaveBeenCalled()
    expect(h.out()).toContain('chaveiro do sistema')
  })

  it('renders the live Ink view while waiting', async () => {
    const h = harness({ tty: true, live: true })
    h.openBrowser.mockResolvedValueOnce(false)
    h.reply(
      ok(deviceStart),
      fail(428, 'AUTHORIZATION_PENDING'),
      ok(deviceToken),
    )

    const code = await h.run('login')

    expect(code).toBe(0)
    expect(h.out()).toContain('ABCD-EFGH')
    expect(h.out()).toContain('Abra no navegador e confirme o código')
    expect(h.out()).toContain('Conectado ao workspace')
  })

  it('warns that STEEL_TOKEN still wins', async () => {
    const h = harness({ tty: true, env: { STEEL_TOKEN: 'stl_pat_env' } })
    h.reply(ok(deviceStart), ok(deviceToken))

    await h.run('login')

    expect(h.err()).toContain('STEEL_TOKEN está definida')
    expect(h.requests[0]?.headers.get('authorization')).toBeNull()
  })

  it.each([
    [fail(410, 'EXPIRED_TOKEN'), 'EXPIRED_TOKEN', 3],
    [fail(403, 'ACCESS_DENIED'), 'ACCESS_DENIED', 3],
    [fail(500, 'INTERNAL_ERROR', 'Falhou'), 'INTERNAL_ERROR', 1],
  ])('maps the poll outcome %#', async (response, code, exit) => {
    const h = harness()
    h.reply(ok(deviceStart), response)

    expect(await h.run('login')).toBe(exit)
    expect(h.errJson().error.code).toBe(code)
    expect(h.out()).toBe('')
  })

  it('reports a cancelled login', async () => {
    const controller = new AbortController()
    controller.abort()
    const h = harness({ interrupt: controller.signal })
    h.reply(ok(deviceStart))

    expect(await h.run('login')).toBe(130)
    expect(h.errJson().error).toEqual({
      code: 'CANCELLED',
      message: 'Login cancelado.',
    })
  })

  it('explains a failure to start the flow', async () => {
    const h = harness({ tty: true })
    h.reply(new TypeError('fetch failed'))

    expect(await h.run('login')).toBe(1)
    expect(h.err()).toContain(
      'Não foi possível conectar a https://homologacao.stratustelecom.com.br.',
    )
  })

  it('keeps the file fallback when the keychain fails', async () => {
    const keychain = memoryKeychain()
    keychain.set = async () => {
      throw new Error('no secret service')
    }
    const h = harness({ keychain })
    h.reply(ok(deviceStart), ok(deviceToken))

    await h.run('login')

    expect(h.outJson().storage).toBe('file')
  })
})
