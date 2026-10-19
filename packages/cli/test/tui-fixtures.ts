import type { ListenMessage, Me, SteelResult } from '@steel-so/sdk'
import { vi } from 'vitest'
import type { DashboardClient, DashboardSession } from '../src/tui/data.js'
import { me as baseMe } from './harness.js'

export const KEY = {
  up: '\u001B[A',
  down: '\u001B[B',
  right: '\u001B[C',
  left: '\u001B[D',
  enter: '\r',
  escape: '\u001B',
  tab: '\t',
  backspace: '\u007F',
} as const

export const okResult = <T>(data: T): SteelResult<T> => ({
  ok: true,
  status: 200,
  data,
})

export const errResult = (
  status: number,
  code: string,
  message?: string,
): SteelResult<never> => ({
  ok: false,
  error: { status, code, ...(message ? { message } : {}) },
})

/** A controllable SSE feed for `webhooks.listen`. */
export function feed() {
  const queue: ListenMessage[] = []
  let wake: (() => void) | undefined
  let closed = false
  const iterable: AsyncIterable<ListenMessage> = {
    async *[Symbol.asyncIterator]() {
      while (true) {
        const next = queue.shift()
        if (next) {
          yield next
          if (next.type === 'disconnected') return
          continue
        }
        if (closed) return
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    },
  }
  return {
    iterable,
    push(message: ListenMessage) {
      queue.push(message)
      wake?.()
    },
    close() {
      closed = true
      wake?.()
    },
  }
}

/** Every SDK call the dashboard makes, as mocks with empty defaults. */
export function mockClient() {
  const empty = okResult({ items: [], nextCursor: null })
  return {
    servicedesk: {
      tickets: {
        list: vi.fn(async () => empty),
        get: vi.fn(),
        create: vi.fn(),
        comment: vi.fn(),
        move: vi.fn(),
      },
      catalog: vi.fn(async () => empty),
      // An older server by default: the move picker falls back to the
      // phases seen in the queue. Tests of the workflow mock a page.
      phases: vi.fn(async () => errResult(404, 'NOT_FOUND')),
    },
    crm: {
      leads: { list: vi.fn(), create: vi.fn(), import: vi.fn() },
      opportunities: { list: vi.fn(async () => empty), move: vi.fn() },
      pipelines: vi.fn(async () => empty),
    },
    whatsapp: {
      templates: vi.fn(async () => empty),
      conversations: { waiting: vi.fn(async () => empty) },
      sendTemplate: vi.fn(),
      broadcast: vi.fn(),
    },
    webhooks: {
      events: vi.fn(),
      listEndpoints: vi.fn(),
      createEndpoint: vi.fn(),
      updateEndpoint: vi.fn(),
      deleteEndpoint: vi.fn(),
      testEndpoint: vi.fn(),
      listDeliveries: vi.fn(),
      retryDelivery: vi.fn(),
      trigger: vi.fn(),
      listen: vi.fn(async () => okResult(feed().iterable)),
    },
  }
}

export type MockClient = ReturnType<typeof mockClient>

export function session(
  client: MockClient,
  overrides: Partial<Me> = {},
): DashboardSession {
  return {
    client: client as unknown as DashboardClient,
    me: {
      ...(baseMe as Me),
      modules: ['SERVICE_DESK', 'CRM', 'COMMUNICATION'],
      scopes: ['api:read', 'api:write'],
      ...overrides,
    },
    profileName: 'homologacao',
    url: 'https://homologacao.stratustelecom.com.br',
    timeZone: 'UTC',
    sleep: async () => {},
  }
}

/** Polls until `check` stops throwing (Ink renders asynchronously). */
export async function waitFor(check: () => void, timeoutMs = 2000) {
  const start = Date.now()
  for (;;) {
    try {
      check()
      return
    } catch (error) {
      if (Date.now() - start > timeoutMs) throw error
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
}

/** Lets Ink process input and effects. */
export const tick = (ms = 20) =>
  new Promise((resolve) => setTimeout(resolve, ms))
