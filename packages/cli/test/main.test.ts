import { CommanderError } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { processDeps, translateCommanderError } from '../src/main.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('translateCommanderError', () => {
  it('falls back to the commander message without the prefix', () => {
    const error = translateCommanderError(
      new CommanderError(1, 'commander.invalidArgument', "error: invalid 'x'"),
    )
    expect(error.message).toBe("invalid 'x'")
    expect(error.exitCode).toBe(2)
  })
})

describe('processDeps', () => {
  it('wires the real process', async () => {
    vi.stubEnv('STEEL_NO_KEYCHAIN', '')
    const deps = processDeps()
    expect(deps.io.stdout).toBe(process.stdout)
    expect(deps.io.stderr).toBe(process.stderr)
    expect(deps.keychain).not.toBeNull()
    expect(typeof deps.hostname()).toBe('string')
    expect(deps.interrupt?.aborted).toBe(false)
    expect(await deps.readFile(new URL(import.meta.url).pathname)).toContain(
      'processDeps',
    )
    expect(await deps.openBrowser('ftp://nope')).toBe(false)
  })

  it('turns the keychain off with STEEL_NO_KEYCHAIN', () => {
    vi.stubEnv('STEEL_NO_KEYCHAIN', '1')
    expect(processDeps().keychain).toBeNull()
  })
})
