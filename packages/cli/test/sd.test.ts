import { describe, expect, it } from 'vitest'
import {
  catalogItems,
  clock,
  domainHarness,
  incidentPhases,
  page,
  path,
  sdPhase,
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
  const inWork = () =>
    ticket({
      phaseId: 'ph_work',
      phase: { ...ticket().phase, id: 'ph_work', name: 'Em atendimento' },
    })
  const resolved = () =>
    ticket({
      phase: { ...ticket().phase, name: 'Resolvido', category: 'RESOLVED' },
      completionPercent: 100,
    })

  it('resolves --phase by name within the ticket type and moves', async () => {
    const h = await domainHarness({ files: { 'fix.md': 'Troquei o cabo' } })
    h.reply(ok(inWork()), ok(page(incidentPhases)), ok(resolved()))

    await h.run(
      'sd',
      'ticket',
      'move',
      '42',
      '--phase',
      'resolvido',
      '--solution',
      '@fix.md',
      '--comment',
      'ok',
    )

    expect(h.requests.map(path)).toEqual([
      'GET /api/v1/servicedesk/tickets/42',
      'GET /api/v1/servicedesk/phases?ticketType=INCIDENT&limit=100',
      'POST /api/v1/servicedesk/tickets/42/phase',
    ])
    expect(await h.requests[2]?.json()).toEqual({
      phaseId: 'ph_done',
      solution: 'Troquei o cabo',
      comment: 'ok',
    })
    expect(h.outJson().phase.name).toBe('Resolvido')
  })

  it('accepts a phase id and any phase of a free-flow phase', async () => {
    const h = await domainHarness()
    const waiting = ticket({
      phaseId: 'ph_wait',
      phase: { ...ticket().phase, id: 'ph_wait', name: 'Aguardando cliente' },
    })
    h.reply(ok(waiting), ok(page(incidentPhases)), ok(ticket()))

    expect(await h.run('sd', 'ticket', 'move', '42', '--phase', 'ph_new')).toBe(
      0,
    )
    expect(await h.requests[2]?.json()).toEqual({ phaseId: 'ph_new' })
  })

  it('refuses a phase the workflow does not allow, before moving', async () => {
    const h = await domainHarness()
    h.reply(ok(ticket()), ok(page(incidentPhases)))

    expect(
      await h.run('sd', 'ticket', 'move', '42', '--phase', 'Resolvido'),
    ).toBe(2)
    expect(h.errJson().error).toMatchObject({
      message: 'O chamado INC-42 não pode ir de Novo para Resolvido.',
      hint: 'Fases permitidas: Em atendimento.',
    })
    expect(h.requests).toHaveLength(2)

    const same = await domainHarness()
    same.reply(ok(ticket()), ok(page(incidentPhases)))
    expect(
      await same.run('sd', 'ticket', 'move', '42', '--phase', 'novo'),
    ).toBe(2)
    expect(same.errJson().error.message).toBe(
      'O chamado INC-42 já está na fase Novo.',
    )

    const dead = await domainHarness()
    const done = ticket({
      phaseId: 'ph_done',
      phase: { ...ticket().phase, id: 'ph_done', name: 'Resolvido' },
    })
    dead.reply(ok(done), ok(page(incidentPhases)))
    expect(
      await dead.run('sd', 'ticket', 'move', '42', '--phase', 'Novo'),
    ).toBe(2)
    expect(dead.errJson().error.hint).toBe('A fase Resolvido não tem saída.')
  })

  it('reports unknown and ambiguous phase names', async () => {
    const h = await domainHarness()
    h.reply(ok(ticket()), ok(page(incidentPhases)))
    expect(await h.run('sd', 'ticket', 'move', '42', '--phase', 'Xyz')).toBe(2)
    expect(h.errJson().error).toMatchObject({
      message: 'Fase não encontrada: Xyz',
      hint: 'Veja as fases com `steel sd phases --type <tipo>`.',
    })

    const twice = await domainHarness()
    twice.reply(
      ok(ticket()),
      ok(page([...incidentPhases, sdPhase({ id: 'ph_dup', name: 'Novo' })])),
    )
    expect(
      await twice.run('sd', 'ticket', 'move', '42', '--phase', 'novo'),
    ).toBe(2)
    expect(twice.errJson().error.message).toBe('Há mais de uma fase “novo”.')
  })

  it('offers only the next phases on a terminal and asks for the solution', async () => {
    const h = await domainHarness({
      answers: ['ph_done', 'Reiniciei o roteador', true],
    })
    h.reply(ok(inWork()), ok(page(incidentPhases)), ok(resolved()))

    await h.run('sd', 'ticket', 'move', '42')

    expect(h.prompt?.questions).toEqual([
      'Mover INC-42 (Em atendimento) para',
      'Solução (a fase Resolvido exige)',
      'Mover o chamado INC-42 para a fase Resolvido?',
    ])
    expect(h.prompt?.choices[0]).toEqual([
      {
        value: 'ph_wait',
        label: 'Aguardando cliente',
        hint: 'Aguardando · 60%',
      },
      { value: 'ph_done', label: 'Resolvido', hint: 'Resolvido · 100%' },
    ])
    expect(await h.requests[2]?.json()).toEqual({
      phaseId: 'ph_done',
      solution: 'Reiniciei o roteador',
    })
    expect(h.out()).toContain('INC-42 agora está em Resolvido (100%).')
  })

  it('says when the current phase has no way out', async () => {
    const h = await domainHarness({ answers: [] })
    const done = ticket({
      phaseId: 'ph_done',
      phase: { ...ticket().phase, id: 'ph_done', name: 'Resolvido' },
    })
    h.reply(ok(done), ok(page(incidentPhases)))
    expect(await h.run('sd', 'ticket', 'move', '42')).toBe(1)
    expect(h.err()).toContain(
      'O chamado INC-42 está na fase Resolvido, que não tem saída.',
    )
  })

  it('falls back to a phase id on servers without the phase list', async () => {
    const h = await domainHarness({ answers: ['ph_2', true] })
    h.reply(
      ok(ticket()),
      fail(404, 'NOT_FOUND'),
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
      'Mover o chamado INC-42 para a fase ph_2?',
    ])
    expect(await h.requests[2]?.json()).toEqual({ phaseId: 'ph_2' })
    expect(h.out()).toContain('INC-42 agora está em Em andamento (40%).')
  })

  it('stops on other phase-list errors', async () => {
    const h = await domainHarness()
    h.reply(ok(ticket()), fail(403, 'API_TOKEN_MODULE_NOT_ALLOWED'))
    expect(await h.run('sd', 'ticket', 'move', '42', '--phase', 'x')).toBe(3)
    expect(h.requests).toHaveLength(2)
  })

  it('needs --phase in a script, before any request', async () => {
    const h = await domainHarness()
    expect(await h.run('sd', 'ticket', 'move', '42')).toBe(2)
    expect(h.errJson().error.message).toBe('Falta --phase.')
    expect(h.requests).toHaveLength(0)
  })
})

describe('steel sd phases', () => {
  it('prints the JSON page with the type filter', async () => {
    const h = await domainHarness()
    h.reply(ok(page(incidentPhases, 'c2')))

    await h.run('sd', 'phases', '--type', 'incidente', '--limit', '4')

    expect(path(h.requests[0])).toBe(
      'GET /api/v1/servicedesk/phases?limit=4&ticketType=INCIDENT',
    )
    expect(h.outJson()).toEqual(page(incidentPhases, 'c2'))
  })

  it('renders the workflow as a table on a terminal', async () => {
    const h = await domainHarness({ tty: true })
    h.reply(
      ok(
        page(
          [
            ...incidentPhases,
            sdPhase({
              id: 'ph_x',
              name: 'Triagem',
              nextPhaseIds: ['ph_elsewhere'],
            }),
          ],
          'c2',
        ),
      ),
    )

    await h.run('sd', 'phases', '--type', 'incidente')

    const out = h.out()
    const line = (text: string) =>
      out.split('\n').find((row) => row.includes(text)) ?? ''
    expect(line('ph_work')).toContain('Aguardando cliente, Resolvido')
    expect(line('ph_wait')).toContain('qualquer')
    expect(line('ph_wait')).toContain('pausa SLA')
    expect(line('ph_done')).toContain('aprovação')
    expect(line('ph_done')).toContain('100%')
    expect(line('ph_new')).toContain('inicial')
    expect(line('ph_x')).toContain('ph_elsewhere')
    expect(out).toContain('steel sd phases --type incidente --cursor c2')
  })

  it('shows the empty state', async () => {
    const h = await domainHarness({ tty: true })
    h.reply(ok(page([])))
    await h.run('sd', 'phases')
    expect(path(h.requests[0])).toBe('GET /api/v1/servicedesk/phases')
    expect(h.out()).toContain('Nenhuma fase ativa.')
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
