import { join } from 'node:path'
import { readJson, writePrivateJson } from '../lib/fs.js'
import type { SecretStorage } from './store.js'

/** Minimal secret store, implemented by the OS keychain and by a file. */
export interface SecretBackend {
  get(profile: string): Promise<string | undefined>
  set(profile: string, secret: string): Promise<void>
  delete(profile: string): Promise<boolean>
}

export const KEYCHAIN_SERVICE = 'steel-cli'
const KEYCHAIN_TIMEOUT_MS = 3000

interface KeyringEntry {
  getPassword(): Promise<string | undefined | null>
  setPassword(password: string): Promise<void>
  deletePassword(): Promise<boolean>
}

export type EntryFactory = (service: string, account: string) => KeyringEntry

/** Some Linux setups hang on a missing Secret Service: never wait forever. */
function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('keychain timed out')),
      KEYCHAIN_TIMEOUT_MS,
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function loadNativeEntry(): Promise<EntryFactory> {
  const { AsyncEntry } = await import('@napi-rs/keyring')
  return (service, account) => new AsyncEntry(service, account)
}

/** OS keychain (macOS Keychain, Windows Credential Manager, Secret Service). */
export function keychainBackend(
  factory: () => Promise<EntryFactory> = loadNativeEntry,
): SecretBackend {
  const entry = async (profile: string) =>
    (await factory())(KEYCHAIN_SERVICE, `profile:${profile}`)
  return {
    async get(profile) {
      const value = await withTimeout((await entry(profile)).getPassword())
      return value ?? undefined
    },
    async set(profile, secret) {
      await withTimeout((await entry(profile)).setPassword(secret))
    },
    async delete(profile) {
      return withTimeout((await entry(profile)).deletePassword())
    },
  }
}

type CredentialsFile = Record<string, { token: string }>

/** `<config>/credentials`, JSON, permission 600 — the keychain fallback. */
export function fileBackend(dir: string): SecretBackend & { path: string } {
  const path = join(dir, 'credentials')
  const read = async (): Promise<CredentialsFile> => {
    const raw = await readJson(path).catch(() => undefined)
    return typeof raw === 'object' && raw !== null
      ? (raw as CredentialsFile)
      : {}
  }
  return {
    path,
    async get(profile) {
      const token = (await read())[profile]?.token
      return typeof token === 'string' ? token : undefined
    },
    async set(profile, secret) {
      const all = await read()
      all[profile] = { token: secret }
      await writePrivateJson(path, all)
    },
    async delete(profile) {
      const all = await read()
      if (!(profile in all)) return false
      delete all[profile]
      await writePrivateJson(path, all)
      return true
    },
  }
}

export interface StoredToken {
  token: string
  storage: SecretStorage
}

/** Keychain first, file as fallback; reads try both. */
export class CredentialStore {
  constructor(
    private readonly keychain: SecretBackend | null,
    private readonly file: SecretBackend,
  ) {}

  async save(profile: string, token: string): Promise<SecretStorage> {
    if (this.keychain) {
      try {
        await this.keychain.set(profile, token)
        await this.file.delete(profile)
        return 'keychain'
      } catch {
        // No usable keychain (headless Linux, CI, containers): use the file.
      }
    }
    await this.file.set(profile, token)
    return 'file'
  }

  async load(profile: string): Promise<StoredToken | undefined> {
    if (this.keychain) {
      const token = await this.keychain.get(profile).catch(() => undefined)
      if (token) return { token, storage: 'keychain' }
    }
    const token = await this.file.get(profile)
    return token ? { token, storage: 'file' } : undefined
  }

  /** Removes the token from both places; `true` when something was removed. */
  async remove(profile: string): Promise<boolean> {
    const fromKeychain = this.keychain
      ? await this.keychain.delete(profile).catch(() => false)
      : false
    const fromFile = await this.file.delete(profile)
    return fromKeychain || fromFile
  }
}
