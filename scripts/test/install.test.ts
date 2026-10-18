import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hostTargetId } from '../lib/targets.js'

const SCRIPT = join(import.meta.dirname, '..', '..', 'install.sh')
const asset = `steel-${hostTargetId(process.platform, process.arch)}.tar.gz`

/** A fake release on disk, served to install.sh through file:// URLs. */
function fakeRelease(options: { corrupt?: boolean; version?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'steel-install-'))
  const build = join(root, 'build')
  mkdirSync(build)
  writeFileSync(join(build, 'steel'), '#!/bin/sh\necho "steel 9.9.9 (test)"\n')
  chmodSync(join(build, 'steel'), 0o755)
  const dir = options.version
    ? join(root, 'releases', 'download', `v${options.version}`)
    : join(root, 'releases', 'latest', 'download')
  mkdirSync(dir, { recursive: true })
  execFileSync('tar', ['-czf', join(dir, asset), '-C', build, 'steel'])
  const hash = options.corrupt
    ? '0'.repeat(64)
    : createHash('sha256')
        .update(readFileSync(join(dir, asset)))
        .digest('hex')
  writeFileSync(join(dir, 'SHA256SUMS'), `${hash}  ${asset}\n`)
  return { root, bin: join(root, 'bin') }
}

function install(
  release: { root: string; bin: string },
  env: Record<string, string> = {},
) {
  return spawnSync('sh', [SCRIPT], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: release.root,
      STEEL_RELEASES_URL: `file://${release.root}/releases`,
      STEEL_INSTALL_DIR: release.bin,
      ...env,
    },
  })
}

describe.skipIf(process.platform === 'win32')('install.sh', () => {
  it('downloads, verifies and installs the latest binary', () => {
    const release = fakeRelease()
    const result = install(release)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`Baixando ${asset}`)
    expect(result.stdout).toContain('steel 9.9.9 (test)')
    expect(result.stdout).toContain(`Adicione ${release.bin} ao PATH`)
    expect(
      execFileSync(join(release.bin, 'steel'), { encoding: 'utf8' }),
    ).toContain('9.9.9')
  })

  it('installs a pinned version and skips the PATH hint when on PATH', () => {
    const release = fakeRelease({ version: '1.2.3' })
    const result = install(release, {
      STEEL_VERSION: 'v1.2.3',
      PATH: `${release.bin}:${process.env.PATH}`,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Comece com: steel login')
  })

  it('refuses a binary whose checksum does not match', () => {
    const release = fakeRelease({ corrupt: true })
    const result = install(release)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('o SHA-256 de')
    expect(result.stderr).toContain('não confere')
  })

  it('fails with a hint when the version does not exist', () => {
    const release = fakeRelease()
    const result = install(release, { STEEL_VERSION: '0.0.1' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('não consegui baixar')
  })
})
