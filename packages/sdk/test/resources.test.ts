import { describe, expect, it } from 'vitest'
import { collectAll, createSteelClient, type Page } from '../src/index.js'
import { errorEnvelope, json, mockFetch } from './helpers.js'

const ok = (data: unknown, status = 200) =>
  json(status, { success: true, statusCode: status, data })

function client(...responses: Array<Response | Error>) {
  const { fetch, calls } = mockFetch(...responses)
  return {
    steel: createSteelClient({
      baseUrl: 'https://steel.test',
      token: 'stl_pat_x',
      fetch,
    }),
    calls,
  }
}

describe('domain resources', () => {
  it('lists tickets with repeated array filters and unwraps the page', async () => {
    const page = { items: [{ id: 't1' }], nextCursor: 'c2' }
    const { steel, calls } = client(ok(page))

    const result = await steel.servicedesk.tickets.list({
      limit: 10,
      status: ['NEW', 'WAITING'],
      assigneeId: ['me'],
      q: 'vpn',
    })

    expect(result).toEqual({ ok: true, status: 200, data: page })
    const url = new URL(calls[0]?.url ?? '')
    expect(url.pathname).toBe('/api/v1/servicedesk/tickets')
    expect(url.searchParams.getAll('status')).toEqual(['NEW', 'WAITING'])
    expect(url.searchParams.get('limit')).toBe('10')
    expect(url.searchParams.get('assigneeId')).toBe('me')
    expect(url.searchParams.get('q')).toBe('vpn')
  })

  it('gets, creates, comments on and moves a ticket', async () => {
    const { steel, calls } = client(
      ok({ id: 't1' }),
      ok({ id: 't2' }, 201),
      ok({ id: 'm1' }, 201),
      ok({ id: 't1' }),
    )

    await steel.servicedesk.tickets.get('42')
    await steel.servicedesk.tickets.create({ type: 'INCIDENT', title: 'VPN' })
    await steel.servicedesk.tickets.comment('t1', {
      body: 'Oi',
      visibility: 'INTERNAL',
    })
    const moved = await steel.servicedesk.tickets.move('t1', {
      phaseId: 'p2',
    })

    expect(moved.ok).toBe(true)
    expect(
      calls.map((call) => `${call.method} ${new URL(call.url).pathname}`),
    ).toEqual([
      'GET /api/v1/servicedesk/tickets/42',
      'POST /api/v1/servicedesk/tickets',
      'POST /api/v1/servicedesk/tickets/t1/comments',
      'POST /api/v1/servicedesk/tickets/t1/phase',
    ])
    expect(await calls[2]?.json()).toEqual({
      body: 'Oi',
      visibility: 'INTERNAL',
    })
  })

  it('reads the catalog, pipelines, opportunities and leads', async () => {
    const empty = { items: [], nextCursor: null }
    const { steel, calls } = client(
      ok(empty),
      ok(empty),
      ok(empty),
      ok(empty),
      ok({ id: 'l1' }, 201),
      ok({ id: 'o1' }),
    )

    await steel.servicedesk.catalog({ ticketType: 'INCIDENT' })
    await steel.crm.pipelines()
    await steel.crm.opportunities.list({ pipelineId: 'p1' })
    await steel.crm.leads.list({ stage: 'RECEIVED' })
    await steel.crm.leads.create({ name: 'Ana', source: 'CLI' })
    await steel.crm.opportunities.move('o1', { stageId: 's2' })

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/api/v1/servicedesk/catalog',
      '/api/v1/crm/pipelines',
      '/api/v1/crm/opportunities',
      '/api/v1/crm/leads',
      '/api/v1/crm/leads',
      '/api/v1/crm/opportunities/o1/stage',
    ])
    expect(new URL(calls[0]?.url ?? '').search).toBe('?ticketType=INCIDENT')
  })

  it('posts the lead CSV untouched as text/csv', async () => {
    const csv = 'name,email\nAna,ana@example.com\n'
    const { steel, calls } = client(
      ok({ total: 1, created: 1, skipped: 0, errors: [] }),
    )

    const result = await steel.crm.leads.import(csv, { source: 'Feira' })

    expect(result.ok).toBe(true)
    expect(calls[0]?.headers.get('content-type')).toBe(
      'text/csv; charset=utf-8',
    )
    expect(await calls[0]?.text()).toBe(csv)
    expect(new URL(calls[0]?.url ?? '').searchParams.get('source')).toBe(
      'Feira',
    )
  })

  it('lists templates, sends one and reads a broadcast', async () => {
    const { steel, calls } = client(
      ok({ items: [], nextCursor: null }),
      ok({ id: 'msg1' }, 201),
      ok({ id: 'b1' }),
    )

    await steel.whatsapp.templates({ status: 'ALL' })
    await steel.whatsapp.sendTemplate({
      templateName: 'boas_vindas',
      language: 'pt_BR',
      to: '5511999990000',
    })
    await steel.whatsapp.broadcast('b1')

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/api/v1/whatsapp/templates',
      '/api/v1/whatsapp/messages/template',
      '/api/v1/whatsapp/broadcasts/b1',
    ])
  })

  it('maps HTTP and network failures to results', async () => {
    const { steel } = client(
      errorEnvelope(404, 'SD_TICKET_NOT_FOUND'),
      new TypeError('fetch failed'),
    )

    const missing = await steel.servicedesk.tickets.get('nope')
    const offline = await steel.crm.pipelines()

    expect(missing).toEqual({
      ok: false,
      error: { status: 404, code: 'SD_TICKET_NOT_FOUND' },
    })
    expect(offline.ok || offline.error.code).toBe('NETWORK_ERROR')
  })
})

describe('collectAll', () => {
  const page = (items: number[], nextCursor: string | null) => ({
    ok: true as const,
    status: 200,
    data: { items, nextCursor } satisfies Page<number>,
  })

  it('follows nextCursor until the last page', async () => {
    const cursors: Array<string | undefined> = []
    const result = await collectAll<number>(async (cursor) => {
      cursors.push(cursor)
      return cursor === undefined ? page([1, 2], 'c2') : page([3], null)
    })

    expect(cursors).toEqual([undefined, 'c2'])
    expect(result).toEqual(page([1, 2, 3], null))
  })

  it('stops when the server repeats a cursor', async () => {
    let calls = 0
    const result = await collectAll<number>(async () => {
      calls += 1
      return page([calls], 'same')
    })

    expect(calls).toBe(2)
    expect(result.ok && result.data.items).toEqual([1, 2])
  })

  it('returns the first error', async () => {
    const failure = {
      ok: false as const,
      error: { status: 500, code: 'INTERNAL' },
    }
    const result = await collectAll<number>(async (cursor) =>
      cursor ? failure : page([1], 'c2'),
    )

    expect(result).toBe(failure)
  })
})
