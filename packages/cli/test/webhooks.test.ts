import { describe, expect, it, vi } from 'vitest'
import { endpointState } from '../src/commands/webhooks.js'
import { fail, harness, ok } from './harness.js'

const BASE = 'https://homologacao.stratustelecom.com.br/api/v1/webhooks'

async function loggedIn(options: Parameters<typeof harness>[0] = {}) {
  const h = harness(options)
  await h.keychain?.set('homologacao', 'stl_pat_x')
  return h
}

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
  lastAttemptAt: '2026-10-18T09:30:00.000Z',
  deliveredAt: '2026-10-18T09:30:00.000Z',
  createdAt: '2026-10-18T09:30:00.000Z',
}

describe('steel trigger', () => {
  it('creates a test event (JSON)', async () => {
    const h = await loggedIn()
    const result = {
      event: { id: 'evt_9', type: 'crm.deal.won' },
      deliveries: 1,
    }
    h.reply(ok(result, 202))

    expect(await h.run('trigger', 'crm.deal.won', '--endpoint', 'whe_1')).toBe(
      0,
    )
    expect(h.outJson()).toEqual(result)
    expect(h.requests[0]?.url).toBe(`${BASE}/trigger`)
    expect(await h.requests[0]?.json()).toEqual({
      type: 'crm.deal.won',
      endpointId: 'whe_1',
    })
  })

  it('explains the result on a terminal', async () => {
    const h = await loggedIn({ tty: true })
    h.reply(
      ok({ event: { id: 'evt_9', type: 'crm.deal.won' }, deliveries: 0 }, 202),
      ok({ event: { id: 'evt_8', type: 'crm.deal.won' }, deliveries: 2 }, 202),
      ok({ event: { id: 'evt_7', type: 'crm.deal.won' }, deliveries: 1 }, 202),
    )
    await h.run('trigger', 'crm.deal.won')
    expect(h.out()).toContain('Evento de teste crm.deal.won criado (evt_9).')
    expect(h.out()).toContain('Quem está com steel listen recebe agora.')
    expect(await h.requests[0]?.json()).toEqual({ type: 'crm.deal.won' })
    await h.run('trigger', 'crm.deal.won')
    expect(h.out()).toContain('2 entregas na fila do endpoint.')
    await h.run('trigger', 'crm.deal.won')
    expect(h.out()).toContain('1 entrega na fila do endpoint.')
  })

  it('maps an unknown type and other errors', async () => {
    const h = await loggedIn()
    h.reply(fail(400, 'VALIDATION_ERROR'), fail(403, 'FORBIDDEN'))
    expect(await h.run('trigger', 'nope')).toBe(2)
    expect(h.errJson().error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Evento fora do catálogo: nope',
    })
    expect(await h.run('trigger', 'crm.deal.won')).toBe(3)
  })
})

describe('steel webhooks events', () => {
  const catalog = [
    {
      type: 'steel.ping',
      module: 'PLATFORM',
      description: 'Teste',
      subscribable: false,
    },
    {
      type: 'crm.lead.created',
      module: 'CRM',
      description: 'Lead criado',
      subscribable: true,
    },
    {
      type: 'agents.approval.pending',
      module: 'AGENTS',
      description: 'Aprovação',
      subscribable: true,
    },
  ]

  it('lists the catalog as a table and as JSON', async () => {
    const h = await loggedIn({ tty: true })
    h.reply(ok(catalog), ok(catalog))
    await h.run('webhooks', 'events')
    expect(h.out()).toContain('TIPO')
    expect(h.out()).toContain(
      'steel.ping               Plataforma  Teste (só sob demanda)',
    )
    expect(h.out()).toContain('crm.lead.created         CRM')
    expect(h.out()).toContain('Agentes')
    expect(h.requests[0]?.url).toBe(`${BASE}/events`)

    h.stdout.output = ''
    await h.run('webhooks', 'events', '--json')
    expect(h.outJson()).toEqual(catalog)
  })

  it('fails with the SDK error', async () => {
    const h = await loggedIn()
    h.reply(fail(401, 'UNAUTHORIZED'))
    expect(await h.run('webhooks', 'events')).toBe(3)
  })
})

describe('steel webhooks endpoints', () => {
  it('lists endpoints with their state', async () => {
    const h = await loggedIn({ tty: true })
    const many = {
      ...endpoint,
      id: 'whe_2',
      events: ['a', 'b', 'c', 'd'],
      failingSince: '2026-10-17T10:00:00.000Z',
    }
    const all = { ...endpoint, id: 'whe_3', events: ['*'], active: false }
    h.reply(ok({ items: [endpoint, many, all], nextCursor: null }))

    await h.run('webhooks', 'endpoints', 'list')

    const out = h.out()
    expect(out).toContain(
      'whe_1  https://erp.example.com/steel  crm.lead.created',
    )
    expect(out).toContain('a, b +2')
    expect(out).toContain('falhando desde 17/10/2026')
    expect(out).toContain('todos')
    expect(out).toContain('desativado')
    expect(out).toContain('whsec_…a1b2')
  })

  it('says when there are none, and prints JSON', async () => {
    const h = await loggedIn({ tty: true })
    h.reply(ok({ items: [], nextCursor: null }))
    await h.run('webhooks', 'endpoints', 'list')
    expect(h.out()).toContain('Nenhum endpoint cadastrado.')

    const j = await loggedIn()
    j.reply(ok({ items: [endpoint], nextCursor: null }), fail(403, 'FORBIDDEN'))
    await j.run('webhooks', 'endpoints', 'list')
    expect(j.outJson().items).toHaveLength(1)
    expect(await j.run('webhooks', 'endpoints', 'list')).toBe(3)
  })

  it('describes the state of an endpoint', () => {
    expect(endpointState(endpoint)).toBe('ativo')
    expect(
      endpointState({ ...endpoint, active: false, disabledReason: 'auto' }),
    ).toBe('desativado (3 dias falhando)')
    expect(
      endpointState({ ...endpoint, active: false, disabledReason: 'manual' }),
    ).toBe('desativado')
  })

  it('creates an endpoint and shows the secret once', async () => {
    const h = await loggedIn({ tty: true })
    h.reply(ok({ endpoint, secret: 'whsec_brand_new' }, 201))

    expect(
      await h.run(
        'webhooks',
        'endpoints',
        'create',
        '--url',
        endpoint.url,
        '--events',
        'crm.lead.created,crm.deal.won',
        '--description',
        'ERP',
        '--inactive',
      ),
    ).toBe(0)
    expect(await h.requests[0]?.json()).toEqual({
      url: endpoint.url,
      events: ['crm.lead.created', 'crm.deal.won'],
      description: 'ERP',
      active: false,
    })
    expect(h.out()).toContain('Endpoint cadastrado.')
    expect(h.out()).toContain('whsec_brand_new')
    expect(h.out()).toContain('Guarde o segredo agora')
    expect(h.out()).toContain('steel webhooks endpoints test whe_1')
  })

  it('subscribes to every event with "*" and prints JSON', async () => {
    const h = await loggedIn()
    const created = { endpoint: { ...endpoint, events: ['*'] }, secret: 's' }
    h.reply(
      ok(created, 201),
      fail(400, 'WEBHOOK_URL_NOT_ALLOWED', 'URL privada'),
    )
    await h.run(
      'webhooks',
      'endpoints',
      'create',
      '--url',
      endpoint.url,
      '--events',
      'crm.lead.created,*',
    )
    expect(await h.requests[0]?.json()).toEqual({
      url: endpoint.url,
      events: ['*'],
    })
    expect(h.outJson()).toEqual(created)

    expect(
      await h.run(
        'webhooks',
        'endpoints',
        'create',
        '--url',
        'https://10.0.0.1',
        '--events',
        '*',
      ),
    ).toBe(1)
    expect(h.errJson().error.message).toBe('URL privada')
  })

  it('needs at least one event', async () => {
    const h = await loggedIn()
    expect(
      await h.run(
        'webhooks',
        'endpoints',
        'create',
        '--url',
        endpoint.url,
        '--events',
        ' , ',
      ),
    ).toBe(2)
    expect(h.requests).toHaveLength(0)
  })

  it('deletes after confirmation, or with --yes', async () => {
    const h = await loggedIn({ tty: true })
    const confirm = vi.fn(async () => true)
    h.deps.confirm = confirm
    h.reply(ok({ id: 'whe_1' }), ok({ id: 'whe_1' }))

    expect(await h.run('webhooks', 'endpoints', 'delete', 'whe_1')).toBe(0)
    expect(confirm).toHaveBeenCalledWith(
      'Remover o endpoint whe_1? As entregas pendentes serão descartadas.',
    )
    expect(h.out()).toContain('Endpoint whe_1 removido.')
    expect(h.requests[0]?.method).toBe('DELETE')
    expect(h.requests[0]?.url).toBe(`${BASE}/endpoints/whe_1`)

    const j = await loggedIn()
    j.reply(ok({ id: 'whe_1' }))
    expect(await j.run('webhooks', 'endpoints', 'delete', 'whe_1', '-y')).toBe(
      0,
    )
    expect(j.outJson()).toEqual({ id: 'whe_1', deleted: true })
  })

  it('does not delete when declined, without a terminal or on error', async () => {
    const h = await loggedIn({ tty: true })
    h.deps.confirm = async () => false
    expect(await h.run('webhooks', 'endpoints', 'delete', 'whe_1')).toBe(130)
    expect(h.requests).toHaveLength(0)

    const j = await loggedIn()
    j.deps.confirm = async () => true
    expect(await j.run('webhooks', 'endpoints', 'delete', 'whe_1')).toBe(2)
    expect(j.errJson().error.hint).toContain('--yes')

    const e = await loggedIn()
    e.reply(fail(404, 'WEBHOOK_ENDPOINT_NOT_FOUND'))
    expect(await e.run('webhooks', 'endpoints', 'delete', 'x', '--yes')).toBe(1)
  })

  it('tests an endpoint and reports its answer', async () => {
    const h = await loggedIn({ tty: true })
    h.reply(
      ok(delivery),
      ok({
        ...delivery,
        status: 'FAILED',
        responseStatus: 500,
        responseBody: 'Internal error',
      }),
      ok({
        ...delivery,
        status: 'FAILED',
        responseStatus: null,
        responseBody: null,
        durationMs: null,
        error: 'timeout',
      }),
    )

    expect(await h.run('webhooks', 'endpoints', 'test', 'whe_1')).toBe(0)
    expect(h.out()).toContain('steel.ping entregue: 200 em 42 ms.')
    expect(h.requests[0]?.url).toBe(`${BASE}/endpoints/whe_1/test`)

    expect(await h.run('webhooks', 'endpoints', 'test', 'whe_1')).toBe(1)
    expect(h.out()).toContain('não confirmou o steel.ping: 500 em 42 ms.')
    expect(h.out()).toContain('Internal error')

    expect(await h.run('webhooks', 'endpoints', 'test', 'whe_1')).toBe(1)
    expect(h.out()).toContain('não confirmou o steel.ping: timeout.')
  })

  it('tests an endpoint in JSON mode', async () => {
    const h = await loggedIn()
    h.reply(
      ok(delivery),
      ok({ ...delivery, status: 'FAILED', error: null, responseStatus: null }),
      fail(404, 'WEBHOOK_ENDPOINT_NOT_FOUND'),
    )
    expect(await h.run('webhooks', 'endpoints', 'test', 'whe_1')).toBe(0)
    expect(h.outJson()).toEqual(delivery)
    expect(await h.run('webhooks', 'endpoints', 'test', 'whe_1')).toBe(1)
    expect(await h.run('webhooks', 'endpoints', 'test', 'x')).toBe(1)
  })
})

describe('steel webhooks deliveries', () => {
  it('lists a page with filters and hints the next cursor', async () => {
    const h = await loggedIn({ tty: true })
    const failed = {
      ...delivery,
      id: 'whd_2',
      status: 'FAILED',
      responseStatus: null,
      durationMs: null,
      error: 'timeout',
      lastAttemptAt: null,
    }
    const noError = { ...failed, id: 'whd_3', error: null }
    h.reply(ok({ items: [delivery, failed, noError], nextCursor: 'c2' }))

    await h.run(
      'webhooks',
      'deliveries',
      'list',
      '--endpoint',
      'whe_1',
      '--status',
      'failed',
      '--limit',
      '3',
    )

    expect(h.requests[0]?.url).toBe(
      `${BASE}/deliveries?endpointId=whe_1&status=FAILED&limit=3`,
    )
    const out = h.out()
    expect(out).toContain('whd_1  steel.ping  entregue')
    expect(out).toContain('200')
    expect(out).toContain('42 ms')
    expect(out).toContain('18/10/2026')
    expect(out).toContain('falhou')
    expect(out).toContain('timeout')
    expect(out).toContain('--cursor c2')
  })

  it('follows every page with --all', async () => {
    const h = await loggedIn()
    h.reply(
      ok({ items: [delivery], nextCursor: 'c2' }),
      ok({ items: [{ ...delivery, id: 'whd_2' }], nextCursor: null }),
    )
    await h.run('webhooks', 'deliveries', 'list', '--all', '--cursor', 'c1')
    expect(h.requests.map((r) => r.url)).toEqual([
      `${BASE}/deliveries?limit=100&cursor=c1`,
      `${BASE}/deliveries?limit=100&cursor=c2`,
    ])
    expect(h.outJson()).toEqual({
      items: [delivery, { ...delivery, id: 'whd_2' }],
      nextCursor: null,
    })
  })

  it('says when the log is empty', async () => {
    const h = await loggedIn({ tty: true })
    h.reply(ok({ items: [], nextCursor: null }))
    await h.run('webhooks', 'deliveries', 'list')
    expect(h.out()).toContain('Nenhuma entrega nos últimos 30 dias.')
    expect(h.requests[0]?.url).toBe(`${BASE}/deliveries`)
  })

  it('validates --limit and --status before calling Steel', async () => {
    const h = await loggedIn()
    expect(await h.run('webhooks', 'deliveries', 'list', '--limit', '0')).toBe(
      2,
    )
    expect(await h.run('webhooks', 'deliveries', 'list', '--limit', 'x')).toBe(
      2,
    )
    expect(
      await h.run('webhooks', 'deliveries', 'list', '--status', 'lost'),
    ).toBe(2)
    expect(h.errJson().error.hint).toContain('SUCCEEDED')
    expect(h.requests).toHaveLength(0)

    h.reply(fail(404, 'WEBHOOK_ENDPOINT_NOT_FOUND'))
    expect(await h.run('webhooks', 'deliveries', 'list')).toBe(1)
  })

  it('retries a delivery', async () => {
    const h = await loggedIn({ tty: true })
    const pending = { ...delivery, status: 'PENDING' }
    h.reply(ok(pending, 202), ok(pending, 202), fail(404, 'NOT_FOUND'))

    expect(await h.run('webhooks', 'deliveries', 'retry', 'whd_1')).toBe(0)
    expect(h.requests[0]?.method).toBe('POST')
    expect(h.requests[0]?.url).toBe(`${BASE}/deliveries/whd_1/retry`)
    expect(h.out()).toContain('Reenvio da entrega whd_1 (steel.ping) na fila.')
    expect(h.out()).toContain('--endpoint whe_1')

    h.stdout.output = ''
    expect(
      await h.run('webhooks', 'deliveries', 'retry', 'whd_1', '--json'),
    ).toBe(0)
    expect(h.outJson()).toEqual(pending)
    expect(await h.run('webhooks', 'deliveries', 'retry', 'x')).toBe(1)
  })
})
