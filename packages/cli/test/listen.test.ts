import { signPayload } from '@steel-so/sdk'
import { describe, expect, it, vi } from 'vitest'
import { parseEventList } from '../src/commands/listen.js'
import {
  FORWARD_TIMEOUT_MS,
  forwardFrame,
  normalizeForwardUrl,
} from '../src/lib/forward.js'
import { abortableSleep, reconnectDelayMs } from '../src/lib/sleep.js'
import { fail, harness } from './harness.js'

const secret = 'whsec_listen_secret'

function event(id: string, type = 'crm.lead.created') {
  return JSON.stringify({
    id,
    type,
    createdAt: '2026-10-18T12:34:56.000Z',
    workspaceId: 'ws_1',
    data: { name: 'Ana' },
  })
}

function frame(id: string, body = event(id), signWith = secret) {
  const timestamp = 1_760_790_896
  return {
    id,
    timestamp,
    signature: signPayload(signWith, timestamp, body),
    body,
  }
}

const ready = (events: string[] = []) =>
  `event: ready\ndata: ${JSON.stringify({ workspaceId: 'ws_1', events, secret })}\n\n`

const webhook = (data: ReturnType<typeof frame>) =>
  `event: webhook\nid: ${data.id}\ndata: ${JSON.stringify(data)}\n\n`

/** An SSE response that sends `chunks` and then stays open or closes. */
function sse(chunks: string[], { close = false } = {}) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        if (close) controller.close()
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )
}

function loggedIn(options: Parameters<typeof harness>[0] = {}) {
  const interrupt = new AbortController()
  const h = harness({ ...options, interrupt: interrupt.signal })
  return { h, interrupt, ready: h.keychain?.set('homologacao', 'stl_pat_x') }
}

describe('steel listen', () => {
  it('streams NDJSON and forwards the exact body and headers', async () => {
    const { h, interrupt, ready: saved } = loggedIn()
    await saved
    const first = frame('evt_1')
    const forwarded: Request[] = []
    h.reply(sse([ready(['crm.lead.created']), ': ping\n\n', webhook(first)]))
    h.reply((request) => {
      forwarded.push(request)
      interrupt.abort()
      return new Response('ok', { status: 202 })
    })

    const code = await h.run(
      'listen',
      '--events',
      'crm.lead.created, crm.lead.created',
      '--forward',
      'localhost:3001/hooks',
    )

    expect(code).toBe(0)
    const lines = h
      .out()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(lines[0]).toEqual({
      type: 'ready',
      profile: 'homologacao',
      url: 'https://homologacao.stratustelecom.com.br',
      events: ['crm.lead.created'],
      forward: 'http://localhost:3001/hooks',
      secret,
    })
    expect(lines[1]).toMatchObject({
      type: 'webhook',
      id: 'evt_1',
      eventType: 'crm.lead.created',
      at: '2026-10-18T12:34:56.000Z',
      verified: true,
      body: JSON.parse(first.body),
      forward: { ok: true, status: 202 },
    })

    const stream = h.requests[0]
    expect(stream?.url).toBe(
      'https://homologacao.stratustelecom.com.br/api/v1/webhooks/listen?events=crm.lead.created',
    )
    expect(stream?.headers.get('authorization')).toBe('Bearer stl_pat_x')
    const local = forwarded[0]
    expect(local?.url).toBe('http://localhost:3001/hooks')
    expect(local?.method).toBe('POST')
    expect(await local?.text()).toBe(first.body)
    expect(local?.headers.get('steel-webhook-id')).toBe('evt_1')
    expect(local?.headers.get('steel-webhook-timestamp')).toBe(
      String(first.timestamp),
    )
    expect(local?.headers.get('steel-signature')).toBe(first.signature)
    expect(local?.headers.get('content-type')).toBe('application/json')
    expect(local?.headers.get('user-agent')).toMatch(/^Steel-Webhooks\/1\.0/)
  })

  it('reconnects with backoff after failures and server closes', async () => {
    const { h, interrupt, ready: saved } = loggedIn()
    await saved
    const sleep = vi.fn(async (_ms: number, _signal?: AbortSignal) => {})
    h.deps.sleep = sleep
    h.reply(
      new TypeError('fetch failed'),
      fail(503, 'SERVICE_UNAVAILABLE'),
      fail(429, 'RATE_LIMITED'),
      sse([ready()], { close: true }),
      sse([ready(), webhook(frame('evt_2'))], { close: true }),
      () => {
        interrupt.abort()
        throw new TypeError('fetch failed')
      },
    )

    expect(await h.run('listen')).toBe(0)

    const out = h
      .out()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(out.map((line) => line.type)).toEqual(['ready', 'webhook'])
    expect(out[1].forward).toBeNull()
    const statuses = h
      .err()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).status)
    expect(statuses.map((s) => s.reason)).toEqual([
      'sem conexão',
      'HTTP 503',
      'limite de requisições',
      'o servidor encerrou',
      'o servidor encerrou',
    ])
    // 1 s, 2 s, 4 s, then reset to 1 s after each successful `ready`.
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([
      1000, 2000, 4000, 1000, 1000,
    ])
    expect(h.requests[0]?.url).toBe(
      'https://homologacao.stratustelecom.com.br/api/v1/webhooks/listen',
    )
  })

  it('honours Retry-After on 429', async () => {
    const { h, interrupt, ready: saved } = loggedIn()
    await saved
    const sleep = vi.fn(async (_ms: number, _signal?: AbortSignal) => {
      interrupt.abort()
    })
    h.deps.sleep = sleep
    h.reply(
      new Response(
        JSON.stringify({ success: false, error: { code: 'RATE_LIMITED' } }),
        {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '7' },
        },
      ),
    )
    expect(await h.run('listen')).toBe(0)
    expect(sleep).toHaveBeenCalledWith(7000, interrupt.signal)
  })

  it('stops on errors a reconnection cannot fix', async () => {
    const forbidden = loggedIn()
    await forbidden.ready
    forbidden.h.reply(fail(403, 'FORBIDDEN', 'Só OWNER/ADMIN'))
    expect(await forbidden.h.run('listen')).toBe(3)
    expect(forbidden.h.errJson().error).toMatchObject({
      code: 'FORBIDDEN',
      message: 'Só OWNER/ADMIN',
    })

    const invalid = loggedIn()
    await invalid.ready
    invalid.h.reply(fail(400, 'VALIDATION_ERROR'))
    expect(await invalid.h.run('listen', '--events', 'nope')).toBe(2)
    expect(invalid.h.errJson().error.hint).toContain('steel webhooks events')

    const anonymous = loggedIn()
    anonymous.h.reply(fail(401, 'UNAUTHORIZED'))
    await anonymous.ready
    expect(await anonymous.h.run('listen')).toBe(3)

    const forbiddenNoMessage = loggedIn()
    await forbiddenNoMessage.ready
    forbiddenNoMessage.h.reply(fail(403, 'FORBIDDEN'))
    expect(await forbiddenNoMessage.h.run('listen')).toBe(3)
    expect(forbiddenNoMessage.h.errJson().error.message).toBe(
      'Sem permissão para escutar os eventos.',
    )
  })

  it('refuses a bad --forward before connecting', async () => {
    const { h } = loggedIn()
    expect(await h.run('listen', '--forward', 'ftp://x')).toBe(2)
    expect(await h.run('listen', '--forward', 'http://')).toBe(2)
    expect(h.requests).toHaveLength(0)
  })

  it('prints a styled log on a terminal, with --print and failures', async () => {
    const { h, interrupt, ready: saved } = loggedIn({ tty: true })
    await saved
    const { ConfigStore } = await import('../src/config/store.js')
    await new ConfigStore(h.dir).update((config) => {
      const profile = config.profiles.homologacao
      if (profile) {
        profile.session = {
          workspace: { id: 'ws_1', slug: 'demo', name: 'Demo' },
          tokenId: 't',
          expiresAt: '2099-01-01T00:00:00.000Z',
          scopes: ['api:read'],
          modules: [],
          storage: 'keychain',
          savedAt: '2026-10-01T00:00:00.000Z',
        }
      }
    })
    const forged = frame('evt_bad', event('evt_bad'), 'whsec_other')
    const noType = frame('evt_raw', 'not json')
    h.reply(
      sse([ready(), webhook(frame('evt_1')), webhook(forged)], {
        close: true,
      }),
      new TypeError('connect ECONNREFUSED'),
      new Response('nope', { status: 500 }),
      sse([ready(), webhook(noType)]),
      () => {
        interrupt.abort()
        throw new DOMException('timed out', 'TimeoutError')
      },
    )

    expect(await h.run('listen', '--print', '--forward', '3001')).toBe(0)

    const out = h.out()
    expect(out).toContain('Escutando eventos de Demo')
    expect(out).toContain('Eventos    todos')
    expect(out).toContain('POST http://localhost:3001/')
    expect(out).toContain(secret)
    expect(out).toContain(
      '12:34:56 crm.lead.created evt_1 → ✖ falhou: connect ECONNREFUSED',
    )
    expect(out).toContain('"name": "Ana"')
    expect(out).toContain('evt_bad → 500 (')
    expect(out).toContain('assinatura inválida')
    expect(out).toContain('Reconectado.')
    expect(out).toContain('? evt_raw → ✖ sem resposta em 10 s')
    expect(out).toContain('not json')
    expect(h.err()).toContain('Conexão perdida (o servidor encerrou)')
    expect(h.err()).toContain('Escuta encerrada. 3 eventos recebidos.')
  })

  it('renders the live Ink view', async () => {
    const { h, interrupt, ready: saved } = loggedIn({ tty: true, live: true })
    await saved
    h.reply(sse([ready(['crm.deal.won']), webhook(frame('evt_1'))]))
    const original = h.stdout.write.bind(h.stdout)
    h.stdout.write = (chunk: string) => {
      const result = original(chunk)
      if (h.stdout.output.includes('evt_1')) interrupt.abort()
      return result
    }

    expect(await h.run('listen')).toBe(0)
    expect(h.out()).toContain('Escutando eventos de ws_1')
    expect(h.out()).toContain('crm.deal.won')
    expect(h.out()).toContain('evt_1')
    expect(h.err()).toContain('1 evento recebido.')
  })

  it('needs a login', async () => {
    const h = harness({ keychain: null })
    expect(await h.run('listen')).toBe(3)
  })
})

describe('listen helpers', () => {
  it('parses the event list', () => {
    expect(parseEventList()).toEqual([])
    expect(parseEventList(' a, b ,a  c,*,')).toEqual(['a', 'b', 'c'])
  })

  it('normalizes the forward URL', () => {
    expect(normalizeForwardUrl('3001')).toBe('http://localhost:3001/')
    expect(normalizeForwardUrl('localhost:3001/hooks')).toBe(
      'http://localhost:3001/hooks',
    )
    expect(normalizeForwardUrl(' https://app.test/x?y=1 ')).toBe(
      'https://app.test/x?y=1',
    )
    expect(() => normalizeForwardUrl('ws://x')).toThrow(/http/)
  })

  it('reports forward timeouts and keeps a non-negative duration', async () => {
    const data = frame('evt_1')
    let clock = 100
    const timeout = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError')
    })
    expect(
      await forwardFrame(
        timeout as unknown as typeof fetch,
        'http://localhost/',
        data,
        { now: () => clock-- },
      ),
    ).toEqual({
      ok: false,
      error: 'timeout',
      message: 'aborted',
      durationMs: 0,
    })
    const weird = vi.fn(async () => {
      throw 'boom'
    })
    expect(
      await forwardFrame(
        weird as unknown as typeof fetch,
        'http://localhost/',
        data,
      ),
    ).toMatchObject({ error: 'network', message: 'boom' })
    expect(FORWARD_TIMEOUT_MS).toBe(10_000)
  })

  it('backs off up to 30 s and sleeps until aborted', async () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(reconnectDelayMs)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ])
    expect(reconnectDelayMs(-1)).toBe(1000)

    const aborted = new AbortController()
    aborted.abort()
    await abortableSleep(60_000, aborted.signal)

    const later = new AbortController()
    const pending = abortableSleep(60_000, later.signal)
    later.abort()
    await pending
    await abortableSleep(1)
  })
})
