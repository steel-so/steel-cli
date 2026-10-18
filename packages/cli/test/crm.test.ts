import { describe, expect, it } from 'vitest'
import { countCsvRows, resolveStage } from '../src/commands/crm.js'
import {
  domainHarness,
  lead,
  opportunity,
  page,
  path,
  pipelineList,
} from './domain-fixtures.js'
import { fail, ok } from './harness.js'

const csv = 'name,email\nAna,ana@example.com\nBia,bia@example.com\n'
const importResult = (errors: unknown[] = []) => ({
  total: 2,
  created: 2 - errors.length,
  skipped: 0,
  errors,
})

describe('steel crm lead list', () => {
  it('filters by stage and prints JSON', async () => {
    const h = await domainHarness()
    h.reply(ok(page([lead()])))

    await h.run('crm', 'lead', 'list', '--stage', 'em-contato')

    expect(path(h.requests[0])).toBe('GET /api/v1/crm/leads?stage=IN_CONTACT')
    expect(h.outJson().items[0].id).toBe('ld_1')
  })

  it('renders a table on a terminal', async () => {
    const h = await domainHarness({ tty: true })
    h.reply(
      ok(
        page([
          lead(),
          lead({ emails: [], company: null, source: null, stage: 'X' }),
        ]),
      ),
    )

    await h.run('crm', 'lead', 'list')

    const out = h.out()
    expect(out).toContain('Carla Dias')
    expect(out).toContain('carla@example.com')
    expect(out).toContain('Recebido')
    expect(out).toContain('10/01/2099')
    expect(out).toContain('2 itens.')
  })
})

describe('steel crm lead create', () => {
  it('creates from flags with the CLI source by default', async () => {
    const h = await domainHarness()
    h.reply(ok(lead(), 201))

    await h.run(
      'crm',
      'lead',
      'create',
      '--name',
      'Carla Dias',
      '--email',
      'carla@example.com',
      '--phone',
      '5511999990000',
      '--company',
      'Acme',
      '--job-title',
      'CTO',
      '--city',
      'Recife',
      '--channel',
      'site',
    )

    expect(await h.requests[0]?.json()).toEqual({
      name: 'Carla Dias',
      source: 'CLI',
      emails: ['carla@example.com'],
      phones: ['5511999990000'],
      company: 'Acme',
      jobTitle: 'CTO',
      city: 'Recife',
      channel: 'site',
    })
  })

  it('asks for the name and confirms on a terminal', async () => {
    const h = await domainHarness({ answers: ['Carla Dias', true] })
    h.reply(ok(lead(), 201))

    await h.run('crm', 'lead', 'create', '--source', 'Feira')

    expect(await h.requests[0]?.json()).toEqual({
      name: 'Carla Dias',
      source: 'Feira',
    })
    expect(h.out()).toContain('Lead Carla Dias criado em Recebido (ld_1).')
  })

  it('maps a duplicate to an error', async () => {
    const h = await domainHarness()
    h.reply(fail(409, 'CRM_LEAD_DUPLICATE', 'Lead já existe'))
    expect(await h.run('crm', 'lead', 'create', '--name', 'X')).toBe(1)
    expect(h.errJson().error.code).toBe('CRM_LEAD_DUPLICATE')
  })
})

describe('steel crm lead import', () => {
  it('uploads the CSV as text/csv and exits 0 without row errors', async () => {
    const h = await domainHarness({ files: { 'leads.csv': csv } })
    h.reply(ok(importResult()))

    const code = await h.run(
      'crm',
      'lead',
      'import',
      'leads.csv',
      '--source',
      'Feira',
    )

    expect(code).toBe(0)
    expect(path(h.requests[0])).toBe(
      'POST /api/v1/crm/leads/import?source=Feira',
    )
    expect(h.requests[0]?.headers.get('content-type')).toContain('text/csv')
    expect(await h.requests[0]?.text()).toBe(csv)
    expect(h.outJson()).toEqual(importResult())
  })

  it('reads stdin, confirms and lists row errors with exit 1', async () => {
    const errors = Array.from({ length: 22 }, (_, i) => ({
      row: i + 2,
      code: 'INVALID_EMAIL',
      message: 'E-mail inválido',
    }))
    const h = await domainHarness({ stdin: csv, answers: [true] })
    h.reply(ok({ total: 22, created: 0, skipped: 0, errors }))

    const code = await h.run('crm', 'lead', 'import', '-')

    expect(code).toBe(1)
    expect(h.prompt?.questions[0]).toBe('Importar 2 linhas de - como leads?')
    const out = h.out()
    expect(out).toContain('Nenhum lead importado de 22 linhas.')
    expect(out).toContain('INVALID_EMAIL')
    expect(out).toContain('Mais 2 erros')
  })

  it('summarizes a partial import', async () => {
    const h = await domainHarness({
      files: { 'one.csv': 'name\nAna\n' },
      answers: [true],
    })
    h.reply(
      ok({
        total: 2,
        created: 1,
        skipped: 1,
        errors: [{ row: 3, code: 'X', message: 'y' }],
      }),
    )

    await h.run('crm', 'lead', 'import', 'one.csv')

    expect(h.prompt?.questions[0]).toBe(
      'Importar 1 linha de one.csv como leads?',
    )
    expect(h.out()).toContain('1 de 2 leads importados.')
    expect(h.out()).not.toContain('Mais')
  })

  it('prints a clean summary without errors', async () => {
    const h = await domainHarness({ tty: true, files: { 'l.csv': csv } })
    h.reply(ok(importResult()))
    await h.run('crm', 'lead', 'import', 'l.csv', '--yes')
    expect(h.out()).toContain('2 de 2 leads importados.')
    expect(h.out()).not.toContain('LINHA')
  })

  it('refuses unreadable, empty and oversized files', async () => {
    const big = `name\n${'x'.repeat(5 * 1024 * 1024)}\n`
    const h = await domainHarness({
      files: { 'empty.csv': 'name\n\n', 'big.csv': big },
    })

    expect(await h.run('crm', 'lead', 'import', 'nope.csv')).toBe(2)
    expect(h.errJson().error.message).toBe('Não foi possível ler nope.csv.')
    expect(await h.run('crm', 'lead', 'import', 'empty.csv')).toBe(2)
    expect(h.errJson().error.message).toContain('não tem linhas de dados')
    expect(await h.run('crm', 'lead', 'import', 'big.csv')).toBe(2)
    expect(h.errJson().error.message).toContain('passa de 5 MB')
    expect(h.requests).toHaveLength(0)
  })

  it('counts data rows', () => {
    expect(countCsvRows('')).toBe(0)
    expect(countCsvRows('name\r\nAna\r\n\r\nBia')).toBe(2)
  })
})

describe('steel crm opportunity list', () => {
  it('prints JSON without fetching pipelines', async () => {
    const h = await domainHarness()
    h.reply(ok(page([opportunity()])))

    await h.run(
      'crm',
      'opportunity',
      'list',
      '--pipeline',
      'pl_sales',
      '--stage',
      'st_prop',
    )

    expect(h.requests.map(path)).toEqual([
      'GET /api/v1/crm/opportunities?pipelineId=pl_sales&stageId=st_prop',
    ])
  })

  it('resolves stage names for the table', async () => {
    const h = await domainHarness({ tty: true })
    h.reply(
      ok(
        page([
          opportunity(),
          opportunity({
            amount: null,
            probability: null,
            closeDate: null,
            stageId: 'st_gone',
          }),
        ]),
      ),
      ok(page(pipelineList)),
    )

    await h.run('crm', 'opportunity', 'list')

    expect(path(h.requests[1])).toBe('GET /api/v1/crm/pipelines?limit=100')
    const out = h.out()
    expect(out).toContain('Vendas › Proposta')
    expect(out).toMatch(/R\$\s12\.500,50/)
    expect(out).toContain('60%')
    expect(out).toContain('01/02/2099')
    expect(out).toContain('st_gone')
  })

  it('skips the pipeline lookup for an empty page', async () => {
    const h = await domainHarness({ tty: true })
    h.reply(ok(page([])))
    await h.run('crm', 'opportunity', 'list')
    expect(h.requests).toHaveLength(1)
    expect(h.out()).toContain('Nenhuma oportunidade encontrada.')
  })
})

describe('resolveStage', () => {
  it('finds by id, by name and by name within a pipeline', () => {
    expect(resolveStage(pipelineList, 'st_won').stage.name).toBe('Ganho')
    expect(resolveStage(pipelineList, 'ganho').pipeline.id).toBe('pl_sales')
    expect(resolveStage(pipelineList, 'proposta', 'renovacao').stage.id).toBe(
      'st_renew_prop',
    )
    expect(resolveStage(pipelineList, 'proposta', 'pl_sales').stage.id).toBe(
      'st_prop',
    )
  })

  it('explains ambiguous and unknown names', () => {
    expect(() => resolveStage(pipelineList, 'Proposta')).toThrow(
      'existe em mais de um funil',
    )
    expect(() => resolveStage(pipelineList, 'Perdido')).toThrow(
      'Etapa não encontrada',
    )
    expect(() => resolveStage(pipelineList, 'Ganho', 'Suporte')).toThrow(
      'Funil não encontrado',
    )
  })
})

describe('steel crm opportunity move', () => {
  it('moves by stage name and sends the pipeline', async () => {
    const h = await domainHarness()
    h.reply(
      ok(page(pipelineList)),
      ok(opportunity({ stageId: 'st_renew_prop' })),
    )

    const code = await h.run(
      'crm',
      'opportunity',
      'move',
      'op_1',
      '--stage',
      'Proposta',
      '--pipeline',
      'Renovação',
    )

    expect(code).toBe(0)
    expect(path(h.requests[1])).toBe(
      'POST /api/v1/crm/opportunities/op_1/stage',
    )
    expect(await h.requests[1]?.json()).toEqual({
      stageId: 'st_renew_prop',
      pipelineId: 'pl_renew',
    })
  })

  it('offers every stage on a terminal and confirms', async () => {
    const h = await domainHarness({ answers: ['st_won', true] })
    h.reply(ok(page(pipelineList)), ok(opportunity({ stageId: 'st_won' })))

    await h.run('crm', 'opportunity', 'move', 'op_1')

    expect(h.prompt?.choices[0]?.map((choice) => choice.label)).toEqual([
      'Vendas › Ganho',
      'Vendas › Proposta',
      'Renovação › Proposta',
    ])
    expect(h.prompt?.questions[1]).toBe(
      'Mover a oportunidade op_1 para Vendas › Ganho?',
    )
    expect(h.out()).toContain('Acme — 50 ramais agora está em Vendas › Ganho.')
  })

  it('needs --stage in a script', async () => {
    const h = await domainHarness()
    h.reply(ok(page(pipelineList)))
    expect(await h.run('crm', 'opportunity', 'move', 'op_1')).toBe(2)
    expect(h.errJson().error.message).toBe('Falta --stage.')
  })
})

describe('steel crm pipelines', () => {
  it('renders each pipeline with its stages in order', async () => {
    const h = await domainHarness({ tty: true })
    h.reply(ok(page(pipelineList)))

    await h.run('crm', 'pipelines')

    const out = h.out()
    expect(out).toContain('Vendas (padrão)')
    expect(out.indexOf('Proposta')).toBeLessThan(out.indexOf('Ganho'))
    expect(out).toContain('Ganha')
    expect(out).toContain('Funil sem etapas.')
  })

  it('prints JSON', async () => {
    const h = await domainHarness()
    h.reply(ok(page(pipelineList)))
    await h.run('crm', 'pipelines', '--limit', '5')
    expect(path(h.requests[0])).toBe('GET /api/v1/crm/pipelines?limit=5')
    expect(h.outJson().items).toHaveLength(3)
  })

  it('shows the empty state', async () => {
    const h = await domainHarness({ tty: true })
    h.reply(ok(page([])))
    await h.run('crm', 'pipelines')
    expect(h.out()).toContain('Nenhum funil configurado.')
  })
})
