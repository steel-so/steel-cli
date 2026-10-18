import { join } from 'node:path'
import { readJson, writePrivateJson } from './fs.js'

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const REGISTRY_TIMEOUT_MS = 1500

interface UpdateCache {
  checkedAt: number
  latest: string
}

function parse(version: string): number[] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  return match ? match.slice(1).map(Number) : undefined
}

/** `true` when `candidate` is a newer stable SemVer than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parse(candidate)
  const b = parse(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

export interface UpdateCheckOptions {
  dir: string
  packageName: string
  current: string
  fetch: typeof globalThis.fetch
  now?: () => number
}

/**
 * Asks npm for the latest version at most once a day (cached in
 * `<config>/update-check.json`). Never throws; `undefined` when up to date
 * or unknown.
 */
export async function checkForUpdate(
  options: UpdateCheckOptions,
): Promise<string | undefined> {
  const now = options.now ?? Date.now
  const path = join(options.dir, 'update-check.json')
  try {
    const cached = (await readJson(path).catch(() => undefined)) as
      | UpdateCache
      | undefined
    let latest = cached?.latest
    if (
      !cached ||
      typeof cached.checkedAt !== 'number' ||
      now() - cached.checkedAt >= UPDATE_CHECK_INTERVAL_MS
    ) {
      const name = options.packageName.replace('/', '%2f')
      const response = await options.fetch(
        `https://registry.npmjs.org/${name}/latest`,
        { signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS) },
      )
      const body = response.ok
        ? ((await response.json()) as { version?: unknown })
        : {}
      latest = typeof body.version === 'string' ? body.version : options.current
      await writePrivateJson(path, { checkedAt: now(), latest })
    }
    return latest && isNewer(latest, options.current) ? latest : undefined
  } catch {
    return undefined
  }
}
