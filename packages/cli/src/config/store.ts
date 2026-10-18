import { join } from 'node:path'
import type { ApiScope, ModuleKind, WorkspaceRef } from '@steel-so/sdk'
import { CliError } from '../errors.js'
import { readJson, writePrivateJson } from '../lib/fs.js'
import { BUILTIN_PROFILES, DEFAULT_PROFILE } from './profiles.js'

export type SecretStorage = 'keychain' | 'file'

/** What `steel login` learned about the token. Never the token itself. */
export interface ProfileSession {
  workspace: WorkspaceRef
  tokenId: string
  expiresAt: string
  scopes: ApiScope[]
  modules: ModuleKind[]
  storage: SecretStorage
  savedAt: string
}

export interface ProfileConfig {
  url: string
  session?: ProfileSession
}

export interface ConfigFile {
  version: 1
  currentProfile: string
  profiles: Record<string, ProfileConfig>
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function withBuiltins(config: ConfigFile): ConfigFile {
  const profiles: Record<string, ProfileConfig> = {}
  for (const [name, builtin] of Object.entries(BUILTIN_PROFILES)) {
    profiles[name] = { ...builtin }
  }
  for (const [name, profile] of Object.entries(config.profiles)) {
    profiles[name] = profile
  }
  return { ...config, profiles }
}

export class ConfigStore {
  readonly path: string

  constructor(dir: string) {
    this.path = join(dir, 'config.json')
  }

  async read(): Promise<ConfigFile> {
    let raw: unknown
    try {
      raw = await readJson(this.path)
    } catch (cause) {
      throw new CliError(
        'O arquivo de configuração do Steel CLI está corrompido.',
        {
          hint: `Corrija ou apague ${this.path} e rode \`steel login\` de novo.`,
          code: 'CONFIG_INVALID',
          cause,
        },
      )
    }
    const stored = isRecord(raw) ? raw : {}
    const profiles = isRecord(stored.profiles) ? stored.profiles : {}
    const valid: Record<string, ProfileConfig> = {}
    for (const [name, profile] of Object.entries(profiles)) {
      if (isRecord(profile) && typeof profile.url === 'string') {
        valid[name] = profile as ProfileConfig
      }
    }
    return withBuiltins({
      version: 1,
      currentProfile:
        typeof stored.currentProfile === 'string'
          ? stored.currentProfile
          : DEFAULT_PROFILE,
      profiles: valid,
    })
  }

  async write(config: ConfigFile): Promise<void> {
    await writePrivateJson(this.path, config)
  }

  async update(mutate: (config: ConfigFile) => void): Promise<ConfigFile> {
    const config = await this.read()
    mutate(config)
    await this.write(config)
    return config
  }
}
