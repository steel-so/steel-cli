import { describe, expect, it } from 'vitest'
import { buildCommit, buildDate, buildDefines } from '../lib/build-info.js'
import { parseChecksums } from '../lib/checksums.js'
import { renderFormula } from '../lib/homebrew.js'
import { assetName, findTarget, hostTargetId, TARGETS } from '../lib/targets.js'

describe('build info', () => {
  it('writes the defines the CLI reads', () => {
    expect(
      buildDefines({
        distribution: 'binary',
        commit: 'abc1234',
        date: new Date('2026-10-17T23:59:00Z'),
      }),
    ).toEqual({
      'process.env.STEEL_BUILD_COMMIT': '"abc1234"',
      'process.env.STEEL_BUILD_DATE': '"2026-10-17"',
      'process.env.STEEL_BUILD_DISTRIBUTION': '"binary"',
    })
  })

  it('uses SOURCE_DATE_EPOCH when set', () => {
    const now = () => new Date('2030-01-01T00:00:00Z')
    expect(buildDate({ SOURCE_DATE_EPOCH: '1760745600' }, now)).toEqual(
      new Date('2025-10-18T00:00:00Z'),
    )
    expect(buildDate({ SOURCE_DATE_EPOCH: 'x' }, now)).toEqual(now())
    expect(buildDate({}, now)).toEqual(now())
  })

  it('takes the commit from GITHUB_SHA, then git, else empty', () => {
    const fail = () => {
      throw new Error('no git')
    }
    expect(buildCommit({ GITHUB_SHA: 'f'.repeat(40) }, fail)).toBe(
      'f'.repeat(40),
    )
    expect(buildCommit({}, () => 'abc\n')).toBe('abc')
    expect(buildCommit({}, fail)).toBe('')
  })
})

function target(id: string) {
  const found = findTarget(id)
  if (!found) throw new Error(id)
  return found
}

describe('targets', () => {
  it('covers the five platforms with unique assets', () => {
    expect(TARGETS.map((t) => t.id)).toEqual([
      'linux-x64',
      'linux-arm64',
      'darwin-x64',
      'darwin-arm64',
      'windows-x64',
    ])
    expect(new Set(TARGETS.map(assetName)).size).toBe(5)
    expect(assetName(target('windows-x64'))).toBe('steel-windows-x64.zip')
    expect(assetName(target('darwin-arm64'))).toBe('steel-darwin-arm64.tar.gz')
    expect(findTarget('plan9-x64')).toBeUndefined()
  })

  it('names the host target', () => {
    expect(hostTargetId('win32', 'x64')).toBe('windows-x64')
    expect(hostTargetId('darwin', 'arm64')).toBe('darwin-arm64')
  })
})

const sums = TARGETS.map(
  (target, i) => `${String(i).repeat(64)}  ${assetName(target)}`,
).join('\n')

describe('checksums', () => {
  it('parses sha256sum output in text and binary mode', () => {
    const parsed = parseChecksums(
      `${'a'.repeat(64)}  one.tar.gz\r\n${'b'.repeat(64)} *two.zip\n\ngarbage\n`,
    )
    expect([...parsed]).toEqual([
      ['one.tar.gz', 'a'.repeat(64)],
      ['two.zip', 'b'.repeat(64)],
    ])
  })
})

describe('homebrew formula', () => {
  it('points each macOS and Linux CPU at its asset and checksum', () => {
    const formula = renderFormula({
      version: '1.2.3',
      checksums: sums,
      repository: 'steel-so/steel-cli',
    })
    expect(formula).toContain('class Steel < Formula')
    expect(formula).toContain('version "1.2.3"')
    expect(formula).toContain(
      'url "https://github.com/steel-so/steel-cli/releases/download/v1.2.3/steel-darwin-arm64.tar.gz"',
    )
    expect(formula).toContain(`sha256 "${'3'.repeat(64)}"`)
    expect(formula).toContain(`sha256 "${'0'.repeat(64)}"`)
    expect(formula).not.toContain('windows')
    expect(formula).toContain(
      'generate_completions_from_executable(bin/"steel", "completion")',
    )
  })

  it('refuses prereleases and incomplete checksums', () => {
    const input = { checksums: sums, repository: 'r/r' }
    expect(() => renderFormula({ ...input, version: '1.0.0-rc.1' })).toThrow(
      'not a stable version',
    )
    expect(() =>
      renderFormula({ ...input, version: '1.0.0', checksums: '' }),
    ).toThrow('SHA256SUMS has no entry for steel-darwin-arm64.tar.gz')
  })
})
