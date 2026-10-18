import { describe, expect, it, vi } from 'vitest'
import type { SteelResult } from '../src/index.js'
import { type DeviceToken, waitForDeviceToken } from '../src/index.js'
import { deviceStart, deviceToken } from './helpers.js'

type Poll = SteelResult<DeviceToken>

function pending(code = 'AUTHORIZATION_PENDING', status = 428): Poll {
  return { ok: false, error: { status, code } }
}

function harness(results: Poll[], start = deviceStart) {
  let clock = 0
  const sleeps: number[] = []
  const pollDeviceToken = vi.fn(async () => {
    const next = results.shift()
    if (!next) throw new Error('no more results')
    return next
  })
  const client = {
    auth: { pollDeviceToken, startDevice: vi.fn() },
  }
  const run = (options: Parameters<typeof waitForDeviceToken>[2] = {}) =>
    waitForDeviceToken(client, start, {
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms)
        clock += ms
      },
      ...options,
    })
  return { run, sleeps, pollDeviceToken }
}

describe('waitForDeviceToken', () => {
  it('polls at the server interval until approved', async () => {
    const onPending = vi.fn()
    const { run, sleeps, pollDeviceToken } = harness([
      pending(),
      pending(),
      { ok: true, status: 200, data: deviceToken },
    ])

    const outcome = await run({ onPending })

    expect(outcome).toEqual({ status: 'approved', token: deviceToken })
    expect(sleeps).toEqual([5000, 5000, 5000])
    expect(pollDeviceToken).toHaveBeenCalledWith('dev-123')
    expect(onPending).toHaveBeenLastCalledWith({
      intervalSeconds: 5,
      attempt: 2,
    })
  })

  it('adds five seconds on SLOW_DOWN and on a bare 429', async () => {
    const { run, sleeps } = harness([
      pending('SLOW_DOWN', 429),
      pending('HTTP_ERROR', 429),
      { ok: true, status: 200, data: deviceToken },
    ])

    await run()

    expect(sleeps).toEqual([5000, 10000, 15000])
  })

  it('maps EXPIRED_TOKEN, ACCESS_DENIED and status fallbacks', async () => {
    expect(await harness([pending('EXPIRED_TOKEN', 410)]).run()).toEqual({
      status: 'expired',
    })
    expect(await harness([pending('GONE', 410)]).run()).toEqual({
      status: 'expired',
    })
    expect(await harness([pending('ACCESS_DENIED', 403)]).run()).toEqual({
      status: 'denied',
    })
    const pendingByStatus = harness([
      pending('SOMETHING', 428),
      { ok: true, status: 200, data: deviceToken },
    ])
    expect((await pendingByStatus.run()).status).toBe('approved')
  })

  it('stops at the local deadline without polling again', async () => {
    const { run, pollDeviceToken } = harness([pending(), pending()], {
      ...deviceStart,
      interval: 4,
      expiresIn: 8,
    })

    expect(await run()).toEqual({ status: 'expired' })
    expect(pollDeviceToken).toHaveBeenCalledTimes(1)
  })

  it('tolerates a few transport failures, then reports them', async () => {
    const network = pending('NETWORK_ERROR', 0)
    const recovered = harness([
      network,
      pending('TIMEOUT', 0),
      pending(),
      network,
      { ok: true, status: 200, data: deviceToken },
    ])
    expect((await recovered.run()).status).toBe('approved')

    const failing = harness([network, network, network])
    expect(await failing.run()).toEqual({
      status: 'error',
      error: network.ok ? undefined : network.error,
    })
  })

  it('returns unknown server errors as fatal', async () => {
    const outcome = await harness([pending('INTERNAL_ERROR', 500)]).run()

    expect(outcome).toEqual({
      status: 'error',
      error: { status: 500, code: 'INTERNAL_ERROR' },
    })
  })

  it('returns cancelled when the signal aborts, with the default sleep', async () => {
    const controller = new AbortController()
    const pollDeviceToken = vi.fn()
    const client = { auth: { pollDeviceToken, startDevice: vi.fn() } }

    const waiting = waitForDeviceToken(client, deviceStart, {
      signal: controller.signal,
    })
    controller.abort()

    expect(await waiting).toEqual({ status: 'cancelled' })
    expect(pollDeviceToken).not.toHaveBeenCalled()

    const already = await waitForDeviceToken(client, deviceStart, {
      signal: controller.signal,
    })
    expect(already).toEqual({ status: 'cancelled' })
  })

  it('waits for real with the default sleep', async () => {
    vi.useFakeTimers()
    try {
      const pollDeviceToken = vi.fn(async () => ({
        ok: true as const,
        status: 200,
        data: deviceToken,
      }))
      const client = { auth: { pollDeviceToken, startDevice: vi.fn() } }
      const waiting = waitForDeviceToken(client, {
        ...deviceStart,
        interval: 0,
      })

      await vi.advanceTimersByTimeAsync(1000)

      expect((await waiting).status).toBe('approved')
    } finally {
      vi.useRealTimers()
    }
  })
})
