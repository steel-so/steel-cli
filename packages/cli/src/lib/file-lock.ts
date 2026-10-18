import { mkdir, open, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { abortableSleep } from './sleep.js'

export interface FileLockOptions {
  /** Give up waiting after this long and run anyway (default 10 s). */
  timeoutMs?: number
  /** A lock file older than this is left over from a crash (default 30 s). */
  staleMs?: number
  /** Pause between attempts (default 100 ms). */
  retryMs?: number
  now?: () => number
}

/**
 * Runs `fn` while holding an exclusive lock file (`open(..., 'wx')`), so
 * several `steel` processes on the same machine take turns. The lock is
 * advisory and best effort: after `timeoutMs` the caller runs without it
 * rather than failing, and a lock older than `staleMs` is broken.
 */
export async function withFileLock<T>(
  path: string,
  fn: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const {
    timeoutMs = 10_000,
    staleMs = 30_000,
    retryMs = 100,
    now = Date.now,
  } = options
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const started = now()
  let owned = false
  while (!owned) {
    try {
      const handle = await open(path, 'wx', 0o600)
      await handle.close()
      owned = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const info = await stat(path).catch(() => undefined)
      if (!info || now() - info.mtimeMs > staleMs) {
        await rm(path, { force: true })
        continue
      }
      if (now() - started >= timeoutMs) break
      await abortableSleep(retryMs)
    }
  }
  try {
    return await fn()
  } finally {
    if (owned) await rm(path, { force: true })
  }
}
