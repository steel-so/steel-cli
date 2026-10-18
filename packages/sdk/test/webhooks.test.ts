import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createSteelClient,
  type ListenMessage,
  signPayload,
} from '../src/index.js'
import { errorEnvelope, json, mockFetch } from './helpers.js'

const ok = (data: unknown, status = 200) =>
  json(status, { success: true, statusCode: status, data })

const endpoint = {
  id: 'whe_1',
  workspaceId: 'ws_1',
  url: 'https://erp.example.com/steel',
  description: null,
  events: ['crm.lead.created'],
  active: true,
  secretHint: 'whsec_…a1b2',
  disabledAt: null,
  disabledReason: null,
  failingSince: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  createdById: 'u1',
  createdAt: '2026-10-18T00:00:00.000Z',
  updatedAt: '2026-10-18T00:00:00.000Z',
}

const delivery = {
  id: 'whd_1',
  endpointId: 'whe_1',
  eventId: 'evt_1',
  eventType: 'steel.ping',
  status: 'SUCCEEDED',
  attempts: 1,
  responseStatus: 200,
  responseBody: 'ok',
  durationMs: 42,
  error: null,
  requestBody: '{}',
  lastAttemptAt: '2026-10-18T00:00:00.000Z',
  deliveredAt: '2026-10-18T00:00:00.000Z',
  createdAt: '2026-10-18T00:00:00.000Z',
}

function client(fetch: typeof globalThis.fetch, timeoutMs?: number) {
  return createSteelClient({
    baseUrl: 'https://steel.test',
    token: 'stl_pat_x',
    fetch,
    userAgent: 'steel-cli/test',
    timeoutMs,
  })
}

describe('webhooks REST calls', () => {
  it('hits the contract routes with the right method and body', async () => {
    const { fetch, calls } = mockFetch(
      ok([
        {
          type: 'crm.lead.created',
          module: 'CRM',
          description: 'x',
          subscribable: true,
        },
      ]),
      ok({ items: [endpoint], nextCursor: null }),
      ok({ endpoint, secret: 'whsec_abc' }, 201),
      ok(endpoint),
      ok({ id: 'whe_1' }),
      ok(delivery),
      ok({ items: [delivery], nextCursor: 'c2' }),
      ok({ ...delivery, status: 'PENDING' }, 202),
      ok(
        { event: { id: 'evt_9', type: 'crm.lead.created' }, deliveries: 0 },
        202,
      ),
    )
    const webhooks = client(fetch).webhooks

    expect((await webhooks.events()).ok).toBe(true)
    expect(await webhooks.listEndpoints()).toMatchObject({
      ok: true,
      data: { items: [endpoint] },
    })
    expect(
      await webhooks.createEndpoint({
        url: endpoint.url,
        events: ['crm.lead.created'],
      }),
    ).toMatchObject({ ok: true, status: 201, data: { secret: 'whsec_abc' } })
    await webhooks.updateEndpoint('whe_1', { active: false })
    await webhooks.deleteEndpoint('whe_1')
    await webhooks.testEndpoint('whe_1')
    expect(
      await webhooks.listDeliveries({ endpointId: 'whe_1', limit: 5 }),
    ).toMatchObject({ ok: true, data: { nextCursor: 'c2' } })
    expect(await webhooks.retryDelivery('whd_1')).toMatchObject({
      ok: true,
      status: 202,
    })
    expect(await webhooks.trigger({ type: 'crm.lead.created' })).toMatchObject({
      ok: true,
      data: { deliveries: 0 },
    })

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET https://steel.test/api/v1/webhooks/events',
      'GET https://steel.test/api/v1/webhooks/endpoints',
      'POST https://steel.test/api/v1/webhooks/endpoints',
      'PATCH https://steel.test/api/v1/webhooks/endpoints/whe_1',
      'DELETE https://steel.test/api/v1/webhooks/endpoints/whe_1',
      'POST https://steel.test/api/v1/webhooks/endpoints/whe_1/test',
      'GET https://steel.test/api/v1/webhooks/deliveries?endpointId=whe_1&limit=5',
      'POST https://steel.test/api/v1/webhooks/deliveries/whd_1/retry',
      'POST https://steel.test/api/v1/webhooks/trigger',
    ])
    expect(await calls[2]?.json()).toEqual({
      url: endpoint.url,
      events: ['crm.lead.created'],
    })
    expect(await calls[3]?.json()).toEqual({ active: false })
    expect(await calls[8]?.json()).toEqual({ type: 'crm.lead.created' })
  })

  it('maps error envelopes', async () => {
    const { fetch } = mockFetch(
      errorEnvelope(
        404,
        'WEBHOOK_ENDPOINT_NOT_FOUND',
        'Endpoint não encontrado',
      ),
    )
    expect(await client(fetch).webhooks.deleteEndpoint('nope')).toEqual({
      ok: false,
      error: {
        status: 404,
        code: 'WEBHOOK_ENDPOINT_NOT_FOUND',
        message: 'Endpoint não encontrado',
      },
    })
  })
})

const encoder = new TextEncoder()

/** An SSE response whose body the test drives. */
function sse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  return {
    response: new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }),
    send: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
    fail: (error: Error) => controller.error(error),
  }
}

const secret = 'whsec_listen'
const eventBody = JSON.stringify({
  id: 'evt_1',
  type: 'crm.lead.created',
  createdAt: '2026-10-18T00:00:00.000Z',
  workspaceId: 'ws_1',
  data: { name: 'Ana' },
})
const frame = {
  id: 'evt_1',
  timestamp: 1_760_788_800,
  signature: signPayload(secret, 1_760_788_800, eventBody),
  body: eventBody,
}
const readyText = `event: ready\ndata: ${JSON.stringify({ workspaceId: 'ws_1', events: [], secret })}\n\n`
const frameText = `event: webhook\nid: evt_1\ndata: ${JSON.stringify(frame)}\n\n`

async function drain(iterable: AsyncIterable<ListenMessage>) {
  const out: ListenMessage[] = []
  for await (const message of iterable) out.push(message)
  return out
}

afterEach(() => {
  vi.useRealTimers()
})

describe('webhooks.listen', () => {
  it('streams ready and webhook messages, then reports the end', async () => {
    const stream = sse()
    const { fetch, calls } = mockFetch(stream.response)

    const result = await client(fetch).webhooks.listen({
      events: ['crm.lead.created', '', 'crm.deal.won'],
    })
    if (!result.ok) throw new Error('expected ok')
    stream.send(readyText)
    stream.send(': ping\n\n')
    stream.send(frameText)
    stream.send('event: webhook\ndata: {"id":"broken"}\n\n')
    stream.send('event: webhook\ndata: not json\n\n')
    stream.send(
      `event: webhook\ndata: ${JSON.stringify({ ...frame, body: 'plain' })}\n\n`,
    )
    stream.send('event: ready\ndata: {"nope":true}\n\n')
    stream.send('event: other\ndata: {}\n\n')
    stream.close()

    expect(await drain(result.data)).toEqual([
      { type: 'ready', ready: { workspaceId: 'ws_1', events: [], secret } },
      { type: 'webhook', frame, event: JSON.parse(eventBody) },
      { type: 'webhook', frame: { ...frame, body: 'plain' }, event: null },
      { type: 'disconnected', reason: 'end' },
    ])
    const request = calls[0]
    expect(request?.url).toBe(
      'https://steel.test/api/v1/webhooks/listen?events=crm.lead.created%2Ccrm.deal.won',
    )
    expect(request?.headers.get('accept')).toBe('text/event-stream')
    expect(request?.headers.get('authorization')).toBe('Bearer stl_pat_x')
  })

  it('omits the filter when no events are given', async () => {
    const stream = sse()
    const { fetch, calls } = mockFetch(stream.response)
    const result = await client(fetch).webhooks.listen()
    stream.close()
    if (result.ok) await drain(result.data)
    expect(calls[0]?.url).toBe('https://steel.test/api/v1/webhooks/listen')
  })

  it('returns HTTP errors before streaming', async () => {
    const { fetch } = mockFetch(
      errorEnvelope(403, 'FORBIDDEN', 'Só OWNER/ADMIN'),
      new Response('oops', { status: 502 }),
    )
    const webhooks = client(fetch).webhooks
    expect(await webhooks.listen()).toEqual({
      ok: false,
      error: { status: 403, code: 'FORBIDDEN', message: 'Só OWNER/ADMIN' },
    })
    expect(await webhooks.listen()).toEqual({
      ok: false,
      error: { status: 502, code: 'HTTP_ERROR' },
    })
  })

  it('maps connection failures and a connect timeout', async () => {
    const { fetch } = mockFetch(new TypeError('fetch failed'))
    expect(await client(fetch).webhooks.listen()).toMatchObject({
      ok: false,
      error: { status: 0, code: 'NETWORK_ERROR' },
    })

    const hanging = vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )
    expect(
      await client(hanging as unknown as typeof fetch, 5).webhooks.listen(),
    ).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } })
  })

  it('reports aborted when the signal fires, also before connecting', async () => {
    const stream = sse()
    const { fetch } = mockFetch(stream.response)
    const controller = new AbortController()
    const result = await client(fetch).webhooks.listen({
      signal: controller.signal,
    })
    if (!result.ok) throw new Error('expected ok')
    stream.send(readyText)
    const iterator = result.data[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toMatchObject({ type: 'ready' })
    controller.abort()
    expect((await iterator.next()).value).toEqual({
      type: 'disconnected',
      reason: 'aborted',
    })
    expect((await iterator.next()).done).toBe(true)

    const aborted = new AbortController()
    aborted.abort()
    const never = mockFetch(new DOMException('aborted', 'AbortError'))
    expect(
      await client(never.fetch).webhooks.listen({ signal: aborted.signal }),
    ).toMatchObject({ ok: false, error: { code: 'ABORTED' } })
  })

  it('disconnects as idle when nothing arrives, heartbeats included', async () => {
    const stream = sse()
    const { fetch } = mockFetch(stream.response)
    const result = await client(fetch).webhooks.listen({ idleTimeoutMs: 20 })
    if (!result.ok) throw new Error('expected ok')
    stream.send(': ping\n\n')
    expect(await drain(result.data)).toEqual([
      { type: 'disconnected', reason: 'idle' },
    ])
  })

  it('reports a broken connection with its message', async () => {
    const stream = sse()
    const { fetch } = mockFetch(stream.response)
    const result = await client(fetch).webhooks.listen()
    if (!result.ok) throw new Error('expected ok')
    stream.send(readyText)
    stream.fail(new Error('socket hang up'))
    const messages = await drain(result.data)
    expect(messages.at(-1)).toEqual({
      type: 'disconnected',
      reason: 'network',
      message: 'socket hang up',
    })
  })
})
