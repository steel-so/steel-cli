import type {
  CrmOpportunity,
  CrmPipeline,
  SdTicket,
  WhatsAppTemplate,
} from '@steel-so/sdk'
import { describe, expect, it } from 'vitest'
import { CliError } from '../src/errors.js'
import { bareInvocation } from '../src/main.js'
import {
  groupByStage,
  knownPhases,
  loadCrm,
  loadQueue,
  loadZap,
  matchesFilter,
  sortBySlaRisk,
  summarizeQueue,
  templateBody,
  toCliError,
} from '../src/tui/data.js'
import { fitColumns, scrollOffset } from '../src/tui/widgets.js'
import {
  clock,
  opportunity,
  page,
  pipelineList,
  template,
  ticket,
} from './domain-fixtures.js'
import { errResult, mockClient, okResult, session } from './tui-fixtures.js'

const tk = (overrides: Record<string, unknown>) =>
  ticket(overrides) as unknown as SdTicket

describe('ServiceDesk queue', () => {
  const breached = tk({
    id: 'b',
    number: 3,
    sla: { firstResponse: clock('breached', -10), resolution: clock('ok', 50) },
  })
  const risky = tk({
    id: 'r',
    number: 2,
    sla: { firstResponse: clock('met'), resolution: clock('at_risk', 20) },
  })
  const soon = tk({
    id: 's',
    number: 5,
    sla: { firstResponse: clock('met'), resolution: clock('ok', 30) },
  })
  const later = tk({
    id: 'l',
    number: 1,
    sla: { firstResponse: clock('met'), resolution: clock('ok', 300) },
  })
  const noClock = tk({
    id: 'n',
    number: 4,
    sla: {
      firstResponse: clock('none', null),
      resolution: clock('none', null),
    },
  })
  const paused = tk({
    id: 'p',
    number: 6,
    sla: {
      firstResponse: clock('weird', null),
      resolution: clock('paused', null),
    },
  })

  it('puts breached and at-risk tickets first, then the nearest deadline', () => {
    const order = sortBySlaRisk([later, noClock, soon, paused, risky, breached])
    expect(order.map((item) => item.id)).toEqual(['b', 'r', 's', 'l', 'p', 'n'])
  })

  it('breaks ties by ticket number and counts the risk', () => {
    const a = tk({ id: 'a', number: 9 })
    const b = tk({ id: 'b2', number: 8 })
    expect(sortBySlaRisk([a, b]).map((item) => item.id)).toEqual(['b2', 'a'])
    expect(summarizeQueue([later, risky, breached])).toMatchObject({
      breached: 1,
      atRisk: 1,
    })
  })

  it('asks the API for my open tickets, every page', async () => {
    const client = mockClient()
    client.servicedesk.tickets.list
      .mockResolvedValueOnce(okResult(page([later], 'c2')) as never)
      .mockResolvedValueOnce(okResult(page([breached])) as never)
    const data = await loadQueue(session(client))
    expect(data.tickets.map((item) => item.id)).toEqual(['b', 'l'])
    expect(client.servicedesk.tickets.list).toHaveBeenNthCalledWith(1, {
      assigneeId: ['me'],
      status: ['NEW', 'IN_PROGRESS', 'WAITING'],
      limit: 100,
      cursor: undefined,
    })
    expect(client.servicedesk.tickets.list).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: 'c2' }),
    )
  })

  it('refuses without the module and maps API errors', async () => {
    const client = mockClient()
    await expect(
      loadQueue(session(client, { modules: ['CRM'] })),
    ).rejects.toMatchObject({
      code: 'MODULE_DISABLED',
      message: 'O token não tem acesso ao módulo ServiceDesk.',
    })
    client.servicedesk.tickets.list.mockResolvedValue(
      errResult(401, 'UNAUTHORIZED') as never,
    )
    await expect(loadQueue(session(client))).rejects.toMatchObject({
      message: 'Token inválido, expirado ou revogado.',
      hint: 'Rode `steel login` para entrar de novo.',
    })
  })

  it('lists the phases seen in the queue, current one excluded', () => {
    const phase = (id: string, position: number) => ({
      id,
      name: id,
      color: null,
      category: 'IN_PROGRESS',
      completionPercent: 50,
      position,
    })
    const tickets = [
      tk({ phaseId: 'b', phase: phase('b', 2) }),
      tk({ phaseId: 'a', phase: phase('a', 1) }),
      tk({ phaseId: 'b', phase: phase('b', 2) }),
      tk({ phaseId: 'c', phase: phase('c', 0) }),
    ]
    expect(knownPhases(tickets, 'a').map((item) => item.id)).toEqual(['c', 'b'])
    expect(knownPhases(tickets).map((item) => item.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('CRM board', () => {
  const pipelines = pipelineList as CrmPipeline[]
  const opportunities = [
    opportunity(),
    opportunity({ id: 'op_2', amount: null }),
    opportunity({ id: 'op_3', stageId: 'st_won', amount: 100 }),
    opportunity({
      id: 'op_4',
      pipelineId: 'pl_renew',
      stageId: 'st_renew_prop',
    }),
  ] as unknown as CrmOpportunity[]

  it('groups by stage in order, default pipeline first, with totals', () => {
    const boards = groupByStage([...pipelines].reverse(), opportunities)
    expect(boards.map((board) => board.pipeline.id)).toEqual([
      'pl_sales',
      'pl_renew',
      'pl_empty',
    ])
    const sales = boards[0]
    expect(sales?.groups.map((group) => group.stage.name)).toEqual([
      'Proposta',
      'Ganho',
    ])
    expect(sales?.groups[0]?.opportunities.map((item) => item.id)).toEqual([
      'op_1',
      'op_2',
    ])
    expect(sales?.groups[0]?.total).toBe(12500.5)
    expect(boards[2]?.groups).toEqual([])
  })

  it('loads pipelines and opportunities, with module and error checks', async () => {
    const client = mockClient()
    client.crm.pipelines.mockResolvedValue(okResult(page(pipelines)) as never)
    client.crm.opportunities.list.mockResolvedValue(
      okResult(page(opportunities)) as never,
    )
    const data = await loadCrm(session(client))
    expect(data.boards).toHaveLength(3)
    expect(client.crm.opportunities.list).toHaveBeenCalledWith({
      limit: 100,
      cursor: undefined,
    })

    await expect(
      loadCrm(session(client, { modules: [] })),
    ).rejects.toMatchObject({ code: 'MODULE_DISABLED' })
    client.crm.pipelines.mockResolvedValue(
      errResult(403, 'FORBIDDEN', 'Sem acesso ao CRM.') as never,
    )
    await expect(loadCrm(session(client))).rejects.toMatchObject({
      message: 'Sem acesso ao CRM.',
    })
  })
})

describe('Comunicação', () => {
  it('loads approved templates', async () => {
    const client = mockClient()
    client.whatsapp.templates.mockResolvedValue(
      okResult(page([template()])) as never,
    )
    const data = await loadZap(session(client))
    expect(data.templates).toHaveLength(1)
    expect(client.whatsapp.templates).toHaveBeenCalledWith({
      status: 'APPROVED',
      limit: 100,
      cursor: undefined,
    })
    await expect(
      loadZap(session(client, { modules: ['CRM'] })),
    ).rejects.toMatchObject({
      message: 'O token não tem acesso ao módulo Comunicação.',
    })
    client.whatsapp.templates.mockResolvedValue(
      errResult(0, 'NETWORK_ERROR') as never,
    )
    await expect(loadZap(session(client))).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    })
  })

  it('joins the text components of a template', () => {
    expect(templateBody(template() as unknown as WhatsAppTemplate)).toBe(
      'Oi {{1}}\n\nOlá {{1}}, seu código é {{2}}. {{1}}!\n\nSteel',
    )
    expect(
      templateBody(
        template({
          components: [{ type: 'BUTTONS' }, null],
        }) as unknown as WhatsAppTemplate,
      ),
    ).toBe('')
  })
})

describe('helpers', () => {
  it('matches every word of the filter, accents and case ignored', () => {
    expect(matchesFilter('Impressão do 3º andar', 'impressao andar')).toBe(true)
    expect(matchesFilter('Impressão', 'VPN')).toBe(false)
    expect(matchesFilter('qualquer', '   ')).toBe(true)
  })

  it('wraps unknown failures in a CliError', () => {
    const known = new CliError('x')
    expect(toCliError(known)).toBe(known)
    expect(toCliError(new Error('boom'))).toMatchObject({
      message: 'Erro inesperado no painel.',
      hint: 'boom',
    })
    expect(toCliError('text').hint).toBe('text')
  })

  it('shrinks the flex column first, then the others, to fit', () => {
    const columns = [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B', flex: true },
      { key: 'c', label: 'C' },
    ]
    const rows = [
      {
        id: '1',
        cells: { a: 'x'.repeat(10), b: 'y'.repeat(30), c: 'z'.repeat(10) },
      },
    ]
    // 10 + 30 + 10 + 2 gaps of 2 + marker 2 = 56
    expect(fitColumns(columns, rows, 80)).toEqual([10, 30, 10])
    expect(fitColumns(columns, rows, 46)).toEqual([10, 20, 10])
    expect(fitColumns(columns, rows, 34)).toEqual([10, 8, 10])
    expect(fitColumns(columns, rows, 30)).toEqual([8, 8, 8])
    expect(fitColumns(columns, rows, 10)).toEqual([8, 8, 8])
  })

  it('scrolls so the selected row stays visible', () => {
    expect(scrollOffset(3, 5, 10)).toBe(0)
    expect(scrollOffset(0, 50, 10)).toBe(0)
    expect(scrollOffset(20, 50, 10)).toBe(15)
    expect(scrollOffset(49, 50, 10)).toBe(40)
  })
})

describe('bareInvocation', () => {
  it('accepts only the global options that make sense without a command', () => {
    expect(bareInvocation([])).toEqual({})
    expect(bareInvocation(['--profile', 'homologacao', '--no-color'])).toEqual({
      profile: 'homologacao',
      color: false,
    })
    expect(bareInvocation(['--profile=prod'])).toEqual({ profile: 'prod' })
    expect(bareInvocation(['--profile'])).toBeUndefined()
    expect(bareInvocation(['--profile', '--json'])).toBeUndefined()
    expect(bareInvocation(['--profile='])).toBeUndefined()
    expect(bareInvocation(['--json'])).toBeUndefined()
    expect(bareInvocation(['whoami'])).toBeUndefined()
  })
})
