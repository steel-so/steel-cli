import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process'

type Spawn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => {
  once(
    event: 'spawn' | 'error',
    listener: (...args: unknown[]) => void,
  ): unknown
  unref(): void
}

export interface OpenBrowserOptions {
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
  spawn?: Spawn
}

/** Command used to open a URL; `$BROWSER` wins when set. */
export function browserCommand(
  url: string,
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): [string, string[]] {
  if (env.BROWSER) return [env.BROWSER, [url]]
  if (platform === 'darwin') return ['open', [url]]
  // `rundll32` takes the URL as a plain argument: no `cmd /c start` quoting.
  if (platform === 'win32') {
    return ['rundll32', ['url.dll,FileProtocolHandler', url]]
  }
  return ['xdg-open', [url]]
}

/**
 * Opens an http(s) URL in the default browser. Resolves `false` (never
 * throws) when the URL is not http(s) or no browser could be launched.
 */
export function openBrowser(
  url: string,
  options: OpenBrowserOptions = {},
): Promise<boolean> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return Promise.resolve(false)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return Promise.resolve(false)
  }
  const [command, args] = browserCommand(
    parsed.toString(),
    options.platform ?? process.platform,
    options.env ?? process.env,
  )
  const spawn = options.spawn ?? (nodeSpawn as unknown as Spawn)
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore' })
      child.once('error', () => resolve(false))
      child.once('spawn', () => {
        child.unref()
        resolve(true)
      })
    } catch {
      resolve(false)
    }
  })
}
