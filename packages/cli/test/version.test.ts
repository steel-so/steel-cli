import { describe, expect, it } from 'vitest'
import {
  BUILD,
  INSTALL_SCRIPT_URL,
  resolveBuildInfo,
  upgradeCommand,
  VERSION,
  versionLine,
} from '../src/version.js'
import { harness } from './harness.js'

describe('build info', () => {
  it('is "source" with no build-time values', () => {
    expect(BUILD).toEqual({
      version: VERSION,
      commit: null,
      date: null,
      distribution: 'source',
    })
    expect(versionLine()).toBe(`steel ${VERSION} (dev)`)
  })

  it('keeps valid values and drops malformed ones', () => {
    expect(
      resolveBuildInfo({
        commit: 'abcdef1234567890',
        date: '2026-10-17',
        distribution: 'binary',
      }),
    ).toEqual({
      version: VERSION,
      commit: 'abcdef1',
      date: '2026-10-17',
      distribution: 'binary',
    })
    expect(
      resolveBuildInfo({ commit: 'zz', date: 'today', distribution: 'brew' }),
    ).toMatchObject({ commit: null, date: null, distribution: 'source' })
    expect(
      versionLine(resolveBuildInfo({ commit: 'abc1234', date: '2026-10-17' })),
    ).toBe(`steel ${VERSION} (abc1234, 2026-10-17)`)
  })

  it('suggests the upgrade that matches the installation', () => {
    const npm = resolveBuildInfo({ distribution: 'npm' })
    const binary = resolveBuildInfo({ distribution: 'binary' })
    expect(upgradeCommand(npm)).toBe('npm install -g @steel-so/cli')
    expect(
      upgradeCommand(binary, '/opt/homebrew/Cellar/steel/1.0.0/bin/steel'),
    ).toBe('brew upgrade steel')
    expect(upgradeCommand(binary, '/home/ana/.local/bin/steel')).toBe(
      `curl -fsSL ${INSTALL_SCRIPT_URL} | sh`,
    )
  })
})

describe('steel version', () => {
  it('prints the build info as JSON', async () => {
    const h = harness()
    expect(await h.run('version', '--json')).toBe(0)
    expect(h.outJson()).toEqual({
      ...BUILD,
      platform: process.platform,
      arch: process.arch,
      runtime: `node ${process.versions.node}`,
    })
  })

  it('renders a key/value view on a terminal', async () => {
    const h = harness({ tty: true })
    expect(await h.run('version')).toBe(0)
    expect(h.out()).toContain(`Versão      ${VERSION}`)
    expect(h.out()).toContain('Commit      —')
    expect(h.out()).toContain('Instalação  código-fonte')
    expect(h.out()).toContain(`${process.platform}-${process.arch}`)
  })

  it('labels binaries and shows commit and date', async () => {
    const h = harness({ tty: true })
    const { Context } = await import('../src/context.js')
    const { version } = await import('../src/commands/version.js')
    await version(
      new Context(h.deps, {}),
      resolveBuildInfo({
        commit: 'abc1234',
        date: '2026-10-17',
        distribution: 'binary',
      }),
    )
    expect(h.out()).toContain('Commit      abc1234')
    expect(h.out()).toContain('Build       2026-10-17')
    expect(h.out()).toContain('Instalação  binário')
  })
})
