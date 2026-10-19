import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CliError, fromSteelError, notLoggedIn } from '../src/errors.js'
import { daysUntil, formatDate, relativeDays } from '../src/lib/format.js'
import { browserCommand, openBrowser } from '../src/lib/open-browser.js'
import { checkForUpdate, isNewer } from '../src/lib/update-check.js'
import { moduleLabel } from '../src/ui/theme.js'
import { harness } from './harness.js'

describe('format', () => {
  it('formats dates and relative days', () => {
    expect(formatDate('2027-01-15T12:00:00.000Z', 'UTC')).toBe(
      '15/01/2027, 12:00',
    )
    const now = Date.parse('2027-01-10T12:00:00.000Z')
    expect(daysUntil('2027-01-15T12:00:00.000Z', now)).toBe(5)
    expect(daysUntil('2027-01-09T12:00:00.000Z', now)).toBe(-1)
    expect(relativeDays(-1)).toBe('expirado')
    expect(relativeDays(0)).toBe('expira hoje')
    expect(relativeDays(1)).toBe('em 1 dia')
    expect(relativeDays(30)).toBe('em 30 dias')
  })

  it('labels modules', () => {
    expect(moduleLabel('SERVICE_DESK')).toBe('ServiceDesk')
    expect(moduleLabel('OTHER')).toBe('OTHER')
  })
})

describe('errors', () => {
  const url = 'https://steel.example'

  it.each([
    [{ status: 0, code: 'NETWORK_ERROR' }, 'Não foi possível conectar', 1],
    [{ status: 0, code: 'TIMEOUT' }, 'demorou demais', 1],
    [{ status: 401, code: 'UNAUTHORIZED' }, 'Token inválido', 3],
    [{ status: 403, code: 'FORBIDDEN' }, 'não tem permissão', 3],
    [
      { status: 403, code: 'FORBIDDEN', message: 'Módulo desativado' },
      'Módulo desativado',
      3,
    ],
    [
      {
        status: 403,
        code: 'API_TOKEN_SCOPE_REQUIRED',
        message: 'Este token só pode ler',
      },
      'Este token só pode ler',
      3,
    ],
    [{ status: 401, code: 'API_TOKEN_EXPIRED' }, 'Token inválido', 3],
    [{ status: 429, code: 'RATE_LIMITED' }, 'Muitas requisições', 1],
    [{ status: 418, code: 'TEAPOT' }, 'O Steel respondeu 418 (TEAPOT).', 1],
    [
      { status: 400, code: 'X', message: 'Campo inválido' },
      'Campo inválido',
      1,
    ],
  ])('maps %j', (error, message, exitCode) => {
    const mapped = fromSteelError(error, url)
    expect(mapped).toBeInstanceOf(CliError)
    expect(mapped.message).toContain(message)
    expect(mapped.exitCode).toBe(exitCode)
    expect(mapped.code).toBe(error.code)
    expect(mapped.hint).toBeTruthy()
  })

  it('names the missing scope of API_TOKEN_SCOPE_REQUIRED', () => {
    const mapped = fromSteelError(
      {
        status: 403,
        code: 'API_TOKEN_SCOPE_REQUIRED',
        details: { requiredScope: 'api:admin' },
      },
      url,
    )
    expect(mapped.exitCode).toBe(3)
    expect(mapped.message).toBe('Este token não tem o escopo api:admin.')
    expect(mapped.hint).toContain('O token não tem o escopo api:admin.')
    expect(mapped.hint).toContain('steel login')
    // Older servers send no details: the only write scope is api:write.
    for (const details of [undefined, null, 'x', { requiredScope: '' }]) {
      expect(
        fromSteelError(
          { status: 403, code: 'API_TOKEN_SCOPE_REQUIRED', details },
          url,
        ).hint,
      ).toContain('escopo api:write')
    }
  })

  it('uses Retry-After in the rate-limit hint', () => {
    expect(
      fromSteelError(
        { status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 12 },
        url,
      ).hint,
    ).toBe('Tente de novo em 12 s.')
    expect(notLoggedIn('x').exitCode).toBe(3)
  })
})

describe('openBrowser', () => {
  it('picks the command per platform and honours $BROWSER', () => {
    expect(browserCommand('https://x', 'linux', {})).toEqual([
      'xdg-open',
      ['https://x'],
    ])
    expect(browserCommand('https://x', 'darwin', {})).toEqual([
      'open',
      ['https://x'],
    ])
    expect(browserCommand('https://x', 'win32', {})).toEqual([
      'rundll32',
      ['url.dll,FileProtocolHandler', 'https://x'],
    ])
    expect(
      browserCommand('https://x', 'linux', { BROWSER: 'firefox' }),
    ).toEqual(['firefox', ['https://x']])
  })

  function fakeSpawn(event: 'spawn' | 'error') {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    const spawn = vi.fn(() => {
      queueMicrotask(() => child.emit(event))
      return child
    })
    return { spawn, child }
  }

  it('resolves true once the browser starts', async () => {
    const { spawn, child } = fakeSpawn('spawn')
    expect(
      await openBrowser('https://steel.example/device?code=A', {
        platform: 'linux',
        env: {},
        spawn,
      }),
    ).toBe(true)
    expect(spawn).toHaveBeenCalledWith(
      'xdg-open',
      ['https://steel.example/device?code=A'],
      { detached: true, stdio: 'ignore' },
    )
    expect(child.unref).toHaveBeenCalled()
  })

  it('resolves false on failures and non-http URLs', async () => {
    const { spawn } = fakeSpawn('error')
    expect(await openBrowser('https://x.example', { spawn, env: {} })).toBe(
      false,
    )
    const throwing = vi.fn(() => {
      throw new Error('ENOENT')
    })
    expect(
      await openBrowser('https://x.example', { spawn: throwing, env: {} }),
    ).toBe(false)
    expect(await openBrowser('file:///etc/passwd', { spawn })).toBe(false)
    expect(await openBrowser('javascript:alert(1)', { spawn })).toBe(false)
    expect(await openBrowser('not a url', { spawn })).toBe(false)
  })
})

describe('update check', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'steel-cli-update-'))
  const registry = (version: unknown, status = 200) =>
    vi.fn(
      async () => new Response(JSON.stringify({ version }), { status }),
    ) as unknown as typeof fetch

  it('compares SemVer', () => {
    expect(isNewer('1.2.4', '1.2.3')).toBe(true)
    expect(isNewer('2.0.0', '1.9.9')).toBe(true)
    expect(isNewer('1.2.3', '1.2.3')).toBe(false)
    expect(isNewer('1.0.0', '1.2.0')).toBe(false)
    expect(isNewer('v1.3.0', '1.2.0')).toBe(true)
    expect(isNewer('2.0.0-beta.1', '1.0.0')).toBe(false)
    expect(isNewer('1.0.0', 'dev')).toBe(false)
  })

  it('asks npm once a day and caches the answer', async () => {
    const cache = dir()
    const fetch = registry('0.2.0')
    let now = 1_000
    const check = () =>
      checkForUpdate({
        dir: cache,
        packageName: '@steel-so/cli',
        current: '0.1.0',
        fetch,
        now: () => now,
      })

    expect(await check()).toBe('0.2.0')
    expect(await check()).toBe('0.2.0')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'https://registry.npmjs.org/@steel-so%2fcli/latest',
    )
    now += 24 * 60 * 60 * 1000
    await check()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('treats missing packages, bad bodies and network errors as up to date', async () => {
    const base = { packageName: '@steel-so/cli', current: '0.1.0' }
    expect(
      await checkForUpdate({ ...base, dir: dir(), fetch: registry('x', 404) }),
    ).toBeUndefined()
    expect(
      await checkForUpdate({ ...base, dir: dir(), fetch: registry(42) }),
    ).toBeUndefined()
    const failing = vi.fn(async () => {
      throw new TypeError('offline')
    }) as unknown as typeof fetch
    expect(
      await checkForUpdate({ ...base, dir: dir(), fetch: failing }),
    ).toBeUndefined()
    const corrupt = dir()
    writeFileSync(join(corrupt, 'update-check.json'), '{bad')
    expect(
      await checkForUpdate({ ...base, dir: corrupt, fetch: registry('0.1.0') }),
    ).toBeUndefined()
  })

  it('prints a notice after an interactive command', async () => {
    const h = harness({
      tty: true,
      live: true,
      env: { STEEL_NO_UPDATE_NOTIFIER: '' },
    })
    h.reply(
      new Response(JSON.stringify({ version: '99.0.0' }), { status: 200 }),
    )

    expect(await h.run('profile', 'list')).toBe(0)

    expect(h.err()).toContain('Nova versão do Steel CLI')
    expect(h.err()).toContain('99.0.0')
    expect(h.err()).toContain('npm install -g @steel-so/cli')
  })

  it('stays quiet in CI, in JSON mode and for completions', async () => {
    for (const argv of [
      ['profile', 'list', '--json'],
      ['completion', 'bash'],
    ]) {
      const h = harness({
        tty: true,
        live: true,
        env: { STEEL_NO_UPDATE_NOTIFIER: '' },
      })
      await h.run(...argv)
      expect(h.fetch).not.toHaveBeenCalled()
    }
    const ci = harness({
      tty: true,
      live: true,
      env: { STEEL_NO_UPDATE_NOTIFIER: '', CI: 'true' },
    })
    await ci.run('profile', 'list')
    expect(ci.fetch).not.toHaveBeenCalled()
  })
})
