import { mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  CredentialStore,
  type EntryFactory,
  fileBackend,
  KEYCHAIN_SERVICE,
  keychainBackend,
} from '../src/config/credentials.js'
import { configDir } from '../src/config/paths.js'
import {
  isPlaceholderUrl,
  isValidProfileName,
  normalizeBaseUrl,
} from '../src/config/profiles.js'
import { ConfigStore } from '../src/config/store.js'
import { CliError } from '../src/errors.js'
import { memoryKeychain } from './harness.js'

const tempDir = () => mkdtempSync(join(tmpdir(), 'steel-cli-config-'))
const mode = (path: string) => statSync(path).mode & 0o777

describe('configDir', () => {
  it('prefers STEEL_CONFIG_DIR, then APPDATA on Windows, then XDG', () => {
    expect(configDir({ STEEL_CONFIG_DIR: '/x' }, 'linux', '/home/a')).toBe('/x')
    expect(configDir({ APPDATA: 'C:\\AppData' }, 'win32', 'C:\\a')).toBe(
      join('C:\\AppData', 'steel'),
    )
    expect(configDir({}, 'win32', '/home/a')).toBe('/home/a/.config/steel')
    expect(configDir({ XDG_CONFIG_HOME: '/xdg' }, 'linux', '/home/a')).toBe(
      '/xdg/steel',
    )
    expect(configDir({}, 'darwin', '/Users/a')).toBe('/Users/a/.config/steel')
  })
})

describe('profiles', () => {
  it('validates names', () => {
    expect(isValidProfileName('homologacao')).toBe(true)
    expect(isValidProfileName('dev_2-a')).toBe(true)
    expect(isValidProfileName('-x')).toBe(false)
    expect(isValidProfileName('Upper')).toBe(false)
    expect(isValidProfileName('a'.repeat(33))).toBe(false)
  })

  it('normalizes base URLs', () => {
    expect(normalizeBaseUrl('https://steel.example/')).toBe(
      'https://steel.example',
    )
    expect(normalizeBaseUrl('https://steel.example/base/')).toBe(
      'https://steel.example/base',
    )
    expect(normalizeBaseUrl('http://localhost:3001')).toBe(
      'http://localhost:3001',
    )
    expect(normalizeBaseUrl('http://[::1]:3001')).toBe('http://[::1]:3001')
    expect(normalizeBaseUrl('http://steel.example')).toBeUndefined()
    expect(normalizeBaseUrl('https://steel.example?x=1')).toBeUndefined()
    expect(normalizeBaseUrl('nope')).toBeUndefined()
  })

  it('detects the placeholder', () => {
    expect(isPlaceholderUrl('https://app.steel.invalid')).toBe(true)
    expect(isPlaceholderUrl('https://steel.example')).toBe(false)
  })
})

describe('ConfigStore', () => {
  it('returns the built-in profiles when nothing is saved', async () => {
    const store = new ConfigStore(tempDir())
    const config = await store.read()
    expect(config.currentProfile).toBe('homologacao')
    expect(Object.keys(config.profiles)).toEqual(['producao', 'homologacao'])
  })

  it('writes with permission 600 and keeps custom profiles', async () => {
    const dir = tempDir()
    const store = new ConfigStore(dir)
    await store.update((config) => {
      config.profiles.local = { url: 'http://localhost:3001' }
      config.currentProfile = 'local'
    })
    expect(mode(store.path)).toBe(0o600)
    expect(mode(dir)).toBe(0o700)
    const config = await store.read()
    expect(config.currentProfile).toBe('local')
    expect(config.profiles.local).toEqual({ url: 'http://localhost:3001' })
  })

  it('drops malformed entries and survives odd JSON', async () => {
    const dir = tempDir()
    const store = new ConfigStore(dir)
    writeFileSync(
      store.path,
      JSON.stringify({ currentProfile: 7, profiles: { bad: 1, nourl: {} } }),
    )
    const config = await store.read()
    expect(config.currentProfile).toBe('homologacao')
    expect(Object.keys(config.profiles)).toEqual(['producao', 'homologacao'])

    writeFileSync(store.path, '[]')
    expect((await store.read()).currentProfile).toBe('homologacao')
  })

  it('throws a CliError for corrupt JSON', async () => {
    const dir = tempDir()
    const store = new ConfigStore(dir)
    writeFileSync(store.path, '{nope')
    await expect(store.read()).rejects.toBeInstanceOf(CliError)
    await expect(store.read()).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
  })
})

describe('credentials', () => {
  it('fileBackend stores tokens with permission 600', async () => {
    const dir = tempDir()
    const file = fileBackend(dir)
    expect(await file.get('a')).toBeUndefined()
    await file.set('a', 'stl_pat_a')
    await file.set('b', 'stl_pat_b')
    expect(mode(file.path)).toBe(0o600)
    expect(await file.get('a')).toBe('stl_pat_a')
    expect(await file.delete('a')).toBe(true)
    expect(await file.delete('a')).toBe(false)
    expect(await file.get('b')).toBe('stl_pat_b')

    writeFileSync(file.path, '{"c":{"token":5}}')
    expect(await file.get('c')).toBeUndefined()
    writeFileSync(file.path, 'garbage')
    expect(await file.get('c')).toBeUndefined()
  })

  it('prefers the keychain and clears the file copy', async () => {
    const dir = tempDir()
    const keychain = memoryKeychain()
    const file = fileBackend(dir)
    await file.set('p', 'old')
    const store = new CredentialStore(keychain, file)

    expect(await store.save('p', 'new')).toBe('keychain')
    expect(await file.get('p')).toBeUndefined()
    expect(await store.load('p')).toEqual({ token: 'new', storage: 'keychain' })
    expect(await store.remove('p')).toBe(true)
    expect(await store.load('p')).toBeUndefined()
    expect(await store.remove('p')).toBe(false)
  })

  it('falls back to the file when the keychain fails', async () => {
    const dir = tempDir()
    const broken = {
      get: vi.fn(async () => {
        throw new Error('locked')
      }),
      set: vi.fn(async () => {
        throw new Error('locked')
      }),
      delete: vi.fn(async () => {
        throw new Error('locked')
      }),
    }
    const store = new CredentialStore(broken, fileBackend(dir))

    expect(await store.save('p', 'tok')).toBe('file')
    expect(await store.load('p')).toEqual({ token: 'tok', storage: 'file' })
    expect(await store.remove('p')).toBe(true)

    const noKeychain = new CredentialStore(null, fileBackend(dir))
    expect(await noKeychain.save('q', 'tok')).toBe('file')
    expect(await noKeychain.remove('q')).toBe(true)
  })

  it('keychainBackend talks to the native entry', async () => {
    const calls: string[] = []
    const store = new Map<string, string>()
    const factory: EntryFactory = (service, account) => {
      calls.push(`${service}/${account}`)
      return {
        getPassword: async () => store.get(account) ?? null,
        setPassword: async (password) => {
          store.set(account, password)
        },
        deletePassword: async () => store.delete(account),
      }
    }
    const backend = keychainBackend(async () => factory)

    expect(await backend.get('p')).toBeUndefined()
    await backend.set('p', 'tok')
    expect(await backend.get('p')).toBe('tok')
    expect(await backend.delete('p')).toBe(true)
    expect(calls[0]).toBe(`${KEYCHAIN_SERVICE}/profile:p`)
  })

  it('keychainBackend gives up on a hanging keychain', async () => {
    vi.useFakeTimers()
    try {
      const backend = keychainBackend(async () => () => ({
        getPassword: () => new Promise(() => {}),
        setPassword: () => new Promise(() => {}),
        deletePassword: () => new Promise(() => {}),
      }))
      const pending = backend.get('p')
      const assertion = expect(pending).rejects.toThrow('keychain timed out')
      await vi.advanceTimersByTimeAsync(3000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('loads the native keyring module', async () => {
    const backend = keychainBackend()
    // Whatever the platform answers, it must resolve or reject, never hang.
    await backend.get('steel-cli-test-nonexistent').catch(() => undefined)
  })
})
