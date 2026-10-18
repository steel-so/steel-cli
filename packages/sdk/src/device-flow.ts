import type { SteelClient } from './client.js'
import type { DeviceAuthorization, DeviceToken } from './models.js'
import type { SteelError } from './result.js'

export type DeviceFlowOutcome =
  | { status: 'approved'; token: DeviceToken }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'cancelled' }
  | { status: 'error'; error: SteelError }

export interface WaitForDeviceTokenOptions {
  signal?: AbortSignal
  /** Injected in tests. Resolves early (without throwing) on abort. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  now?: () => number
  /** Called after every poll that is still pending. */
  onPending?: (info: { intervalSeconds: number; attempt: number }) => void
  /** Consecutive transport failures tolerated before giving up. */
  maxNetworkFailures?: number
}

/** RFC 8628 §3.5: a `slow_down` adds five seconds to the interval. */
const SLOW_DOWN_STEP_SECONDS = 5

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })

function classify(error: SteelError) {
  switch (error.code) {
    case 'AUTHORIZATION_PENDING':
      return 'pending'
    case 'SLOW_DOWN':
    case 'RATE_LIMITED':
      return 'slow-down'
    case 'EXPIRED_TOKEN':
      return 'expired'
    case 'ACCESS_DENIED':
      return 'denied'
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
      return 'transient'
  }
  if (error.status === 428) return 'pending'
  if (error.status === 429) return 'slow-down'
  if (error.status === 410) return 'expired'
  return 'fatal'
}

/**
 * Polls `POST /api/v1/auth/device/token` until the user approves or denies
 * the code on `/device`, the code expires, or `signal` aborts.
 */
export async function waitForDeviceToken(
  client: Pick<SteelClient, 'auth'>,
  start: DeviceAuthorization,
  options: WaitForDeviceTokenOptions = {},
): Promise<DeviceFlowOutcome> {
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now
  const maxNetworkFailures = options.maxNetworkFailures ?? 3
  const deadline = now() + start.expiresIn * 1000
  let intervalSeconds = Math.max(1, start.interval)
  let networkFailures = 0
  let attempt = 0

  while (true) {
    await sleep(intervalSeconds * 1000, options.signal)
    if (options.signal?.aborted) return { status: 'cancelled' }
    if (now() >= deadline) return { status: 'expired' }

    attempt += 1
    const result = await client.auth.pollDeviceToken(start.deviceCode)
    if (result.ok) return { status: 'approved', token: result.data }

    const kind = classify(result.error)
    if (kind === 'transient') {
      networkFailures += 1
      if (networkFailures >= maxNetworkFailures) {
        return { status: 'error', error: result.error }
      }
      continue
    }
    networkFailures = 0
    if (kind === 'expired') return { status: 'expired' }
    if (kind === 'denied') return { status: 'denied' }
    if (kind === 'fatal') return { status: 'error', error: result.error }
    if (kind === 'slow-down') intervalSeconds += SLOW_DOWN_STEP_SECONDS
    options.onPending?.({ intervalSeconds, attempt })
  }
}
