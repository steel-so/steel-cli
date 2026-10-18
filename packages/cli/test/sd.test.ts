import { describe, expect, it } from 'vitest'
import {
  catalogItems,
  clock,
  domainHarness,
  page,
  path,
  ticket,
} from './domain-fixtures.js'
import { fail, ok } from './harness.js'

describe('steel sd ticket list', () => {
  it('prints the page as JSON with the filters mapped to the API', async () => {
    const h = await domainHarness()
    const body = page([ticket()], 'c2')
    h.reply(ok(body))

    const code = await h.run(
      'sd',
      'ticket',
      'list',
      '--status',
      'aguardando,novo',
      '--type',
      'incidente',
      '--assignee',
      'me',
      '--phase',
      'ph_1',
      '--priority',
      'pr_1',
      '-s',
      'vpn',
      '--limit',
      '10',
    )

    expect(code).toBe(0)
    expect(h.outJson()).toEqual(body)
    expect(path(h.requests[0])).toBe(
      'GET /api/v1/servicedesk/tickets?limit=10&status=WAITING&status=NEW&type=INCIDENT&phaseId=ph_1&priorityId=pr_1&assigneeId=me&q=vpn',
    )
    expect(h.requests[0]?.headers.get('authorization')).toBe(
      'Bearer stl_pat_saved',
    )
  })

  it('renders a table with SLA and a next-page hint on a terminal', async () => {
    const h = await domainHarness({ tty: true })
    h.reply(
      ok(
        page(
          [
            ticket(),
            ticket({
              code: 'REQ-7',
              type: 'SERVICE_REQUEST',
              priority: null,
              assignee: null,
              sla: {
                firstResponse: clock('none', null),
                resolution: clock('breached', -30),
              },
            }),
          ],
          'c2',
        ),
      ),
    )

    await h.run('sd', 'ticket', 'list')

    const out = h.out()
    expect(out).toContain('CÓDIGO')
    expect(out).toContain('INC-42')
    expect(out).toContain('no prazo (1 h)')
    expect(out).toContain('estourado (30 min atrás)')
    expect(out).toContain('Requisição')
    expect(out).toContain('steel sd ticket list --cursor c2')
  })

  it('follows every cursor with --all, 100 per page', async () => {
    const h = await domainHarness()
    h.reply(ok(page([ticket()], 'c2')), ok(page([ticket({ id: 'tk_2' })])))

    await h.run('sd', 'ticket', 'list', '--all')

    expect(h.requests.map(path)).toEqual([
      'GET /api/v1/servicedesk/tickets?limit=100',
      'GET /api/v1/servicedesk/tickets?limit=100&cursor=c2',
    ])
    expect(h.outJson().items).toHaveLength(2)
    expect(h.outJson().nextCursor).toBeNull()
  })

  it('shows an empty state and the item count', async () => {
    const empty = await domainHarness({ tty: true })
    empty.reply(ok(page([])))
    await empty.run('sd', 'ticket', 'list')
    expect(empty.out()).toContain('Nenhum chamado encontrado')

    const one = await domainHarness({ tty: true })
    one.reply(ok(page([ticket()])))
    await one.run('sd', 'ticket', 'list')
    expect(one.out()).toContain('1 item.')
  })

  it.each([
    [['--status', 'talvez'], 'Valor inválido para --status: talvez'],
    [['--limit', '0'], '--limit inválido: 0'],
    [['--limit', '101'], '--limit inválido: 101'],
    [['--all', '--cursor', 'x'], 'Use --all ou --cursor'],
  ])('refuses %j', async (flags, message) => {
    const h = await domainHarness()
    expect(await h.run('sd', 'ticket', 'list', ...flags)).toBe(2)
    expect(h.errJson().error.message).toContain(message)
    expect(h.requests).toHaveLength(0)
  })

  it('maps API errors (module not in the token) to exit 3', async () => {
    const h = await domainHarness()
    h.reply(fail(403, 'FORBIDDEN', 'O token não inclui o ServiceDesk'))

    expect(await h.run('sd', 'ticket', 'list')).toBe(3)
    expect(h.errJson().error).toMatchObject({
      code: 'FORBIDDEN',
      message: 'O token não inclui o ServiceDesk',
    })
  })

  it('needs a login', async () => {
    const h = await domainHarness()
    await h.keychain?.delete('homologacao')
    expect(await h.run('sd', 'ticket', 'list')).toBe(3)
    expect(h.errJson().error.code).toBe('NOT_LOGGED_IN')
  })
})

describe('steel sd ticket view', () => {
  it('prints the ticket as JSON', async () => {
    const h = await domainHarness()
    h.reply(ok(ticket()))

    expect(await h.run('sd', 'ticket', 'view', '42')).toBe(0)
    expect(path(h.requests[0])).toBe('GET /api/v1/servicedesk/tickets/42')
    expect(h.outJson().code).toBe('INC-42')
  })

  it('renders the details on a terminal', async () => {
    const h = await domainHarness({ tty: true })
    h.reply(
      ok(
        ticket({
          closedAt: '2099-01-11T10:00:00.000Z',
          sla: {
            firstResponse: clock('at_risk', 20),
            resolution: clock('breached', -90),
          },
        }),
      ),
    )

    await h.run('sd', 'ticket', 'view', 'tk_1')

    const out = h.out()
    expect(out).toContain('INC-42 VPN fora do ar')
    expect(out).toContain('Rede › VPN')
    expect(out).toContain('Ana <ana@example.com>')
    expect(out).toContain('em risco (20 min)')
    expect(out).toContain('estourado (1 h atrás)')
    expect(out).toContain('Fechado em')
    expect(out).toContain('Ninguém conecta desde as 9h.')
  })

  it('handles a bare ticket', async () => {
    const h = await domainHarness({ tty: true })
    h.reply(
      ok(
        ticket({
          description: null,
          priority: null,
          category: null,
          service: null,
          assignee: null,
          requester: null,
          tags: [],
          sla: {
            firstResponse: clock('paused', null),
            resolution: clock('none', null),
          },
        }),
      ),
    )

    await h.run('sd', 'ticket', 'view', '42')

    const out = h.out()
    expect(out).toContain('pausado')
    expect(out).not.toContain('Fechado em')
  })

  it('reports a missing ticket', async () => {
    const h = await domainHarness()
    h.reply(fail(404, 'SD_TICKET_NOT_FOUND', 'Chamado não encontrado'))
    expect(await h.run('sd', 'ticket', 'view', '999')).toBe(1)
    expect(h.errJson().error.code).toBe('SD_TICKET_NOT_FOUND')
  })
})

describe('steel sd ticket create', () => {
  it('creates from flags without prompts in a script', async () => {
    const h = await domainHarness({ files: { 'desc.md': 'Detalhes' } })
    h.reply(ok(ticket(), 201))

    const code = await h.run(
      'sd',
      'ticket',
      'create',
      '--type',
      'INCIDENT',
      '--title',
      'VPN fora do ar',
      '--description',
      '@desc.md',
      '--service',
      'svc_1',
      '--category',
      'cat_1',
      '--subcategory',
      'sub_1',
      '--priority',
      'pr_1',
      '--assignee',
      'u_1',
      '--tag',
      'rede,vpn',
    )

    expect(code).toBe(0)
    expect(await h.requests[0]?.json()).toEqual({
      type: 'INCIDENT',
      title: 'VPN fora do ar',
      description: 'Detalhes',
      serviceId: 'svc_1',
      categoryId: 'cat_1',
      subcategoryId: 'sub_1',
      priorityId: 'pr_1',
      assigneeId: 'u_1',
      tags: ['rede', 'vpn'],
    })
    expect(h.outJson().code).toBe('INC-42')
  })

  it('fails on a missing flag outside a terminal', async () => {
    const h = await domainHarness()
    expect(await h.run('sd', 'ticket', 'create', '--type', 'problema')).toBe(2)
    expect(h.errJson().error.message).toBe('Falta --title.')
    expect(h.requests).toHaveLength(0)
  })

  it('asks for the missing fields, the service and a confirmation', async () => {
    const h = await domainHarness({
      answers: [
        'SERVICE_REQUEST',
        'Novo notebook',
        'Para a Ana',
        'svc_1',
        true,
      ],
    })
    h.reply(ok(page(catalogItems)), ok(ticket({ code: 'REQ-1' }), 201))

    expect(await h.run('sd', 'ticket', 'create')).toBe(0)

    expect(h.prompt?.questions).toEqual([
      'Tipo do chamado',
      'Título',
      'Descrição (opcional)',
      'Serviço do catálogo',
      'Abrir requisição “Novo notebook”?',
    ])
    expect(h.prompt?.choices[1]?.map((choice) => choice.label)).toEqual([
      'Rede › VPN',
      'Fax',
      'Nenhum (sem serviço)',
    ])
    expect(path(h.requests[0])).toBe(
      'GET /api/v1/servicedesk/catalog?limit=100&ticketType=SERVICE_REQUEST',
    )
    expect(await h.requests[1]?.json()).toEqual({
      type: 'SERVICE_REQUEST',
      title: 'Novo notebook',
      description: 'Para a Ana',
      serviceId: 'svc_1',
    })
    expect(h.out()).toContain('Chamado REQ-1 aberto na fase Novo.')
    expect(h.out()).toContain('steel sd ticket view 42')
  })

  it('accepts "no service" and skips the picker on an empty catalog', async () => {
    const none = await domainHarness({
      answers: ['T', '', '__none__', true],
    })
    none.reply(ok(page(catalogItems)), ok(ticket(), 201))
    await none.run('sd', 'ticket', 'create', '--type', 'incidente')
    expect(await none.requests[1]?.json()).toEqual({
      type: 'INCIDENT',
      title: 'T',
    })

    const empty = await domainHarness({ answers: ['T', '', true] })
    empty.reply(ok(page([catalogItems[0]])), ok(ticket(), 201))
    await empty.run('sd', 'ticket', 'create', '--type', 'incidente')
    expect(empty.prompt?.questions).not.toContain('Serviço do catálogo')
  })

  it('cancels when the confirmation is declined', async () => {
    const h = await domainHarness({ answers: [false] })

    const code = await h.run(
      'sd',
      'ticket',
      'create',
      '--type',
      'mudanca',
      '--title',
      'Janela',
    )

    expect(code).toBe(130)
    expect(h.requests).toHaveLength(0)
    expect(h.err()).toContain('Operação cancelada.')
  })

  it('skips the confirmation with --yes', async () => {
    const h = await domainHarness({ answers: [] })
    h.reply(ok(ticket(), 201))

    await h.run(
      'sd',
      'ticket',
      'create',
      '--type',
      'incidente',
      '--title',
      'X',
      '--yes',
    )

    expect(h.prompt?.questions).toEqual([])
    expect(h.requests).toHaveLength(1)
  })

  it('rejects an unknown type', async () => {
    const h = await domainHarness()
    expect(
      await h.run('sd', 'ticket', 'create', '--type', 'bug', '--title', 'x'),
    ).toBe(2)
    expect(h.errJson().error.hint).toContain('incident')
  })
})

describe('steel sd ticket comment', () => {
  it('posts a public comment from the flag', async () => {
    const h = await domainHarness()
    h.reply(ok({ id: 'm1', body: 'Oi' }, 201))

    await h.run('sd', 'ticket', 'comment', '42', '-m', ' Oi ')

    expect(path(h.requests[0])).toBe(
      'POST /api/v1/servicedesk/tickets/42/comments',
    )
    expect(await h.requests[0]?.json()).toEqual({
      body: 'Oi',
      visibility: 'PUBLIC',
    })
    expect(h.outJson().id).toBe('m1')
  })

  it('reads stdin and posts an internal note after confirming', async () => {
    const h = await domainHarness({ stdin: 'Nota\n', answers: [true] })
    h.reply(ok({ id: 'm2' }, 201))

    await h.run('sd', 'ticket', 'comment', '42', '-m', '@-', '--internal')

    expect(await h.requests[0]?.json()).toEqual({
      body: 'Nota',
      visibility: 'INTERNAL',
    })
    expect(h.prompt?.questions[0]).toContain('interno')
    expect(h.out()).toContain('Comentário interno publicado')
  })

  it('asks for the text on a terminal', async () => {
    const h = await domainHarness({ answers: ['Resolvido?', true] })
    h.reply(ok({ id: 'm3' }, 201))

    await h.run('sd', 'ticket', 'comment', '42')

    expect(h.prompt?.questions[1]).toContain('público (o solicitante vê)')
    expect(h.out()).toContain('Comentário público publicado')
  })

  it('refuses an empty body, a missing file and a missing flag', async () => {
    const empty = await domainHarness({ stdin: '   ' })
    expect(await empty.run('sd', 'ticket', 'comment', '1', '-m', '@-')).toBe(2)
    expect(empty.errJson().error.message).toBe('O comentário está vazio.')

    const missing = await domainHarness()
    expect(
      await missing.run('sd', 'ticket', 'comment', '1', '-m', '@nope.md'),
    ).toBe(2)
    expect(missing.errJson().error.message).toBe(
      'Não foi possível ler nope.md.',
    )

    const script = await domainHarness()
    expect(await script.run('sd', 'ticket', 'comment', '1')).toBe(2)
    expect(script.errJson().error.message).toBe('Falta --message.')
  })
})

describe('steel sd ticket move', () => {
  it('moves with a solution and a comment', async () => {
    const h = await domainHarness({ files: { 'fix.md': 'Troquei o cabo' } })
    const moved = ticket({
      phase: { ...ticket().phase, name: 'Resolvido', category: 'RESOLVED' },
      completionPercent: 100,
    })
    h.reply(ok(moved))

    await h.run(
      'sd',
      'ticket',
      'move',
      '42',
      '--phase',
      'ph_done',
      '--solution',
      '@fix.md',
      '--comment',
      'ok',
    )

    expect(path(h.requests[0])).toBe(
      'POST /api/v1/servicedesk/tickets/42/phase',
    )
    expect(await h.requests[0]?.json()).toEqual({
      phaseId: 'ph_done',
      solution: 'Troquei o cabo',
      comment: 'ok',
    })
  })

  it('asks for the phase and confirms on a terminal', async () => {
    const h = await domainHarness({ answers: ['ph_2', true] })
    h.reply(
      ok(
        ticket({
          phase: { ...ticket().phase, name: 'Em andamento' },
          completionPercent: 40,
        }),
      ),
    )

    await h.run('sd', 'ticket', 'move', '42')

    expect(h.prompt?.questions).toEqual([
      'Id da fase de destino',
      'Mover o chamado 42 para a fase ph_2?',
    ])
    expect(await h.requests[0]?.json()).toEqual({ phaseId: 'ph_2' })
    expect(h.out()).toContain('INC-42 agora está em Em andamento (40%).')
  })

  it('needs --phase in a script', async () => {
    const h = await domainHarness()
    expect(await h.run('sd', 'ticket', 'move', '42')).toBe(2)
    expect(h.errJson().error.message).toBe('Falta --phase.')
  })
})

describe('steel sd catalog', () => {
  it('lists the catalog as an indented table', async () => {
    const h = await domainHarness({ tty: true })
    h.reply(ok(page(catalogItems)))

    await h.run('sd', 'catalog', '--type', 'requisicao')

    expect(path(h.requests[0])).toBe(
      'GET /api/v1/servicedesk/catalog?ticketType=SERVICE_REQUEST',
    )
    const out = h.out()
    expect(out).toContain('Rede')
    expect(out).toContain('    VPN')
    expect(out).toContain('Incidente, Requisição')
    expect(out).toContain('todos')
    expect(out).toContain('Fax (inativo)')
  })

  it('prints JSON and the empty state', async () => {
    const h = await domainHarness()
    h.reply(ok(page(catalogItems)))
    await h.run('sd', 'catalog')
    expect(path(h.requests[0])).toBe('GET /api/v1/servicedesk/catalog')
    expect(h.outJson().items).toHaveLength(3)

    const empty = await domainHarness({ tty: true })
    empty.reply(ok(page([])))
    await empty.run('sd', 'catalog')
    expect(empty.out()).toContain('O catálogo está vazio.')
  })
})
