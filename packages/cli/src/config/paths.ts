import { homedir } from 'node:os'
import { join } from 'node:path'

export type Env = Record<string, string | undefined>

/**
 * Where the CLI keeps its files. `STEEL_CONFIG_DIR` wins; then `%APPDATA%`
 * on Windows and `$XDG_CONFIG_HOME` (or `~/.config`) elsewhere.
 */
export function configDir(
  env: Env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (env.STEEL_CONFIG_DIR) return env.STEEL_CONFIG_DIR
  if (platform === 'win32' && env.APPDATA) return join(env.APPDATA, 'steel')
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'steel')
}
