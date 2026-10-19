import type { WhatsAppTemplate } from '@steel-so/sdk'
import { describe, expect, it } from 'vitest'
import {
  buildComponents,
  normalizePhone,
  parseVars,
  templateVariables,
  variableKeys,
} from '../src/commands/zap.js'
import {
  broadcast,
  conversation,
  domainHarness,
  page,
  path,
  template,
} from './domain-fixtures.js'
import { fail, ok } from './harness.js'

const message = {
  id: 'msg_1',
  conversationId: 'cv_1',
  direction: 'OUT',
  type: 'TEMPLATE',
  status: 'PENDING',
  createdAt: '2099-01-10T09:00:00.000Z',
}

const tpl = (overrides: Record<string, unknown> = {}) =>
  template(overrides) as unknown as WhatsAppTemplate

describe('template variables', () => {
  it('reads positional and named placeholders of the header and body', () => {
    expect(templateVariables(tpl())).toEqual({
      header: ['1'],
      body: ['1', '2'],
    })
    expect(
      templateVariables(
        tpl({
          components: [
            { type: 'header', format: 'IMAGE' },
            { type: 'body', text: 'Oi {{ nome }}' },
          ],
        }),
      ),
    ).toEqual({ header: [], body: ['nome'] })
    expect(
      templateVariables(
        tpl({ components: [{ type: 'HEADER', text: '{{x}}' }, null] }),
      ),
    ).toEqual({ header: ['x'], body: [] })
    expect(variableKeys({ header: ['1'], body: ['1', '2'] })).toEqual([
      'header.1',
      '1',
      '2',
    ])
  })

  it('builds the Cloud API components in position order', () => {
    expect(
      buildComponents(
        { header: ['1'], body: ['2', '1', 'nome'] },
        { 'header.1': 'H', 1: 'Ana', 2: '123', nome: 'Bia' },
      ),
    ).toEqual([
      { type: 'header', parameters: [{ type: 'text', text: 'H' }] },
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Ana' },
          { type: 'text', text: '123' },
          { type: 'text', parameter_name: 'nome', text: 'Bia' },
        ],
      },
    ])
    expect(buildComponents({ header: [], body: [] }, {})).toEqual([])
  })

  it('parses --var pairs and phone numbers', () => {
    expect(parseVars(['1=Ana', 'body.2=x=y', 'header.1=H'])).toEqual({
      1: 'Ana',
      2: 'x=y',
      'header.1': 'H',
    })
    expect(parseVars()).toEqual({})
    expect(() => parseVars(['=x'])).toThrow('Variável inválida')
    expect(normalizePhone('+55 (11) 99999-0000')).toBe('5511999990000')
    expect(() => normalizePhone('abc')).toThrow('Número inválido')
  })
})

describe('steel zap waiting', () => {
  it('prints the JSON page with the filters', async () => {
    const h = await domainHarness()
    const body = page([conversation()], 'c2')
    h.reply(ok(body))

    await h.run(
      'zap',
      'waiting',
      '--connection',
      'conn_1',
      '--team',
      'team_1',
      '--limit',
      '5',
    )

    expect(path(h.requests[0])).toBe(
      'GET /api/v1/whatsapp/conversations/waiting?limit=5&connectionId=conn_1&teamId=team_1',
    )
    expect(h.outJson()).toEqual(body)
  })

  it('renders the queue on a terminal', async () => {
    const h = await domainHarness({ tty: true })
    h.reply(
      ok(
        page([
          conversation(),
          conversation({
            id: 'cv_2',
            contactName: null,
            contactWaId: '5511988887777',
            team: { id: 'team_1', name: 'Financeiro' },
            teamId: 'team_1',
            status: 'IN_PROGRESS',
            aiActive: true,
            unreadCount: 0,
            lastMessageAt: null,
            lastMessagePreview: null,
          }),
        ]),
      ),
    )

    await h.run('zap', 'waiting')

    const out = h.out()
    const line = (text: string) =>
      out.split('\n').find((row) => row.includes(text)) ?? ''
    expect(line('cv_1')).toContain('Dani Lima')
    expect(line('cv_1')).toContain('Geral')
    expect(line('cv_1')).toContain('10/01/2099, 09:30')
    expect(line('cv_1')).not.toContain('sim')
    expect(line('cv_2')).toContain('+5511988887777')
    expect(line('cv_2')).toContain('Financeiro')
    expect(line('cv_2')).toContain('sim')
    expect(line('cv_2')).toContain('10/01/2099, 09:00')
    expect(out).toContain('2 itens.')
  })

  it('shows the empty state', async () => {
    const h = await domainHarness({ tty: true })
    h.reply(ok(page([])))
    await h.run('zap', 'waiting')
    expect(path(h.requests[0])).toBe(
      'GET /api/v1/whatsapp/conversations/waiting',
    )
    expect(h.out()).toContain('Nenhuma conversa aguardando atendimento.')
  })
})

describe('steel zap templates', () => {
  it('lists approved templates with their variables', async () => {
    const h = await domainHarness({ tty: true })
    h.reply(
      ok(
        page([
          template(),
          template({
            name: 'aviso',
            components: [],
            quality: 'RED',
            status: 'PAUSED',
          }),
        ]),
      ),
    )

    await h.run('zap', 'templates')

    expect(path(h.requests[0])).toBe('GET /api/v1/whatsapp/templates')
    const out = h.out()
    expect(out).toContain('boas_vindas')
    expect(out).toContain('header.1, 1, 2')
    expect(out).toContain('Aprovado')
    expect(out).toContain('Pausado')
    expect(out).toContain('Baixa')
  })

  it('maps --status and --connection and prints JSON', async () => {
    const h = await domainHarness()
    h.reply(ok(page([template()])))

    await h.run('zap', 'templates', '--status', 'todos', '--connection', 'c1')

    expect(path(h.requests[0])).toBe(
      'GET /api/v1/whatsapp/templates?status=ALL&connectionId=c1',
    )
    expect(h.outJson().items).toHaveLength(1)
  })

  it('explains the empty state', async () => {
    const approved = await domainHarness({ tty: true })
    approved.reply(ok(page([])))
    await approved.run('zap', 'templates')
    expect(approved.out()).toContain('Nenhum template aprovado')

    const rejected = await domainHarness({ tty: true })
    rejected.reply(ok(page([])))
    await rejected.run('zap', 'templates', '--status', 'rejeitado')
    expect(rejected.out()).toContain('Nenhum template com esse status.')
  })
})

describe('steel zap send', () => {
  it('sends to a phone number from flags', async () => {
    const h = await domainHarness()
    h.reply(ok(page([template()])), ok(message, 201))

    const code = await h.run(
      'zap',
      'send',
      '--template',
      'boas_vindas',
      '--to',
      '+55 11 99999-0000',
      '--var',
      '1=Ana',
      '--var',
      '2=123',
      '--var',
      'header.1=Oi',
    )

    expect(code).toBe(0)
    expect(path(h.requests[0])).toBe(
      'GET /api/v1/whatsapp/templates?limit=100&status=APPROVED',
    )
    expect(path(h.requests[1])).toBe('POST /api/v1/whatsapp/messages/template')
    expect(await h.requests[1]?.json()).toEqual({
      templateName: 'boas_vindas',
      language: 'pt_BR',
      connectionId: 'conn_1',
      to: '5511999990000',
      components: [
        { type: 'header', parameters: [{ type: 'text', text: 'Oi' }] },
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Ana' },
            { type: 'text', text: '123' },
          ],
        },
      ],
    })
    expect(h.outJson()).toEqual(message)
  })

  it('targets a contact or a conversation instead of a number', async () => {
    const plain = template({ components: [] })
    const contact = await domainHarness()
    contact.reply(ok(page([plain])), ok(message, 201))
    await contact.run(
      'zap',
      'send',
      '--template',
      'boas_vindas',
      '--contact',
      'ct_1',
    )
    expect(await contact.requests[1]?.json()).toEqual({
      templateName: 'boas_vindas',
      language: 'pt_BR',
      connectionId: 'conn_1',
      contactId: 'ct_1',
    })

    const conversation = await domainHarness({ tty: true })
    conversation.reply(ok(page([plain])), ok(message, 201))
    await conversation.run(
      'zap',
      'send',
      '--template',
      'boas_vindas',
      '--conversation',
      'cv_9',
      '--yes',
    )
    expect(await conversation.requests[1]?.json()).toEqual({
      templateName: 'boas_vindas',
      language: 'pt_BR',
      conversationId: 'cv_9',
    })
    expect(conversation.out()).toContain('enviado para a conversa cv_9')
  })

  it('asks for the template, number, variables and confirmation', async () => {
    const h = await domainHarness({
      answers: [
        'boas_vindas',
        'tpl_en',
        '5511999990000',
        'H',
        'Ana',
        '1',
        true,
      ],
    })
    h.reply(
      ok(page([template()], 'c2')),
      ok(page([template({ id: 'tpl_en', language: 'en_US' })])),
      ok(message, 201),
    )

    expect(await h.run('zap', 'send')).toBe(0)

    expect(h.prompt?.questions).toEqual([
      'Template',
      'Qual versão do template?',
      'Número de destino (com DDI e DDD)',
      'Valor de {{header.1}}',
      'Valor de {{1}}',
      'Valor de {{2}}',
      'Enviar o template boas_vindas (en_US) para +5511999990000?',
    ])
    expect(h.prompt?.choices[0]).toEqual([
      { value: 'boas_vindas', label: 'boas_vindas' },
    ])
    expect(await h.requests[2]?.json()).toMatchObject({ language: 'en_US' })
    expect(h.out()).toContain(
      'Template boas_vindas enviado para +5511999990000.',
    )
    expect(h.out()).toContain('status pending')
  })

  it('picks the version by --language', async () => {
    const h = await domainHarness()
    h.reply(
      ok(
        page([
          template({ components: [] }),
          template({ id: 'tpl_en', language: 'en_US', components: [] }),
        ]),
      ),
      ok(message, 201),
    )

    await h.run(
      'zap',
      'send',
      '--template',
      'boas_vindas',
      '--language',
      'en_US',
      '--connection',
      'conn_1',
      '--to',
      '5511999990000',
    )

    expect(await h.requests[1]?.json()).toMatchObject({ language: 'en_US' })
  })

  it.each([
    [
      ['--template', 'nope', '--to', '5511999990000'],
      'Template aprovado não encontrado: nope.',
    ],
    [
      ['--template', 'boas_vindas', '--language', 'es', '--to', '1'],
      'Template aprovado não encontrado: boas_vindas (es).',
    ],
    [['--template', 'boas_vindas'], 'Falta --to.'],
    [
      ['--template', 'boas_vindas', '--to', '5511999990000', '--var', '9=x'],
      'O template boas_vindas não tem a variável 9.',
    ],
    [
      ['--template', 'boas_vindas', '--to', '5511999990000', '--var', '1=a'],
      'Falta --var header.1=<valor>.',
    ],
    [['--template', 'dup', '--to', '5511999990000'], 'Há mais de um template'],
  ])('refuses %j in a script', async (flags, error) => {
    const h = await domainHarness()
    h.reply(
      ok(
        page([
          template(),
          template({ id: 'd1', name: 'dup' }),
          template({ id: 'd2', name: 'dup', connectionId: 'conn_2' }),
        ]),
      ),
    )
    expect(await h.run('zap', 'send', ...flags)).toBe(2)
    expect(h.errJson().error.message).toContain(error)
    expect(h.requests).toHaveLength(1)
  })

  it('explains variables on a template without any', async () => {
    const h = await domainHarness()
    h.reply(ok(page([template({ components: [] })])))
    await h.run(
      'zap',
      'send',
      '--template',
      'boas_vindas',
      '--to',
      '5511999990000',
      '--var',
      'a=1',
      '--var',
      'b=2',
    )
    expect(h.errJson().error).toMatchObject({
      message: 'O template boas_vindas não tem as variáveis a, b.',
      hint: 'Este template não tem variáveis.',
    })
  })

  it('refuses --contact with --conversation before any request', async () => {
    const h = await domainHarness()
    expect(
      await h.run('zap', 'send', '--contact', 'a', '--conversation', 'b'),
    ).toBe(2)
    expect(h.requests).toHaveLength(0)
  })

  it('maps a Meta failure', async () => {
    const h = await domainHarness()
    h.reply(
      ok(page([template({ components: [] })])),
      fail(502, 'WHATSAPP_PROVIDER_ERROR', 'A Meta recusou o envio'),
    )
    expect(
      await h.run(
        'zap',
        'send',
        '--template',
        'boas_vindas',
        '--to',
        '5511999990000',
      ),
    ).toBe(1)
    expect(h.errJson().error.message).toBe('A Meta recusou o envio')
  })
})

describe('steel zap broadcast status', () => {
  it('prints JSON', async () => {
    const h = await domainHarness()
    h.reply(ok(broadcast()))

    await h.run('zap', 'broadcast', 'status', 'bc_1')

    expect(path(h.requests[0])).toBe('GET /api/v1/whatsapp/broadcasts/bc_1')
    expect(h.outJson().id).toBe('bc_1')
  })

  it('shows progress and failed recipients', async () => {
    const h = await domainHarness({ tty: true })
    h.reply(ok(broadcast({ scheduledAt: '2099-01-10T09:00:00.000Z' })))

    await h.run('zap', 'broadcast', 'status', 'bc_1')

    const out = h.out()
    expect(out).toContain('Black Friday')
    expect(out).toContain('Enviando')
    expect(out).toContain('████████████░░░░░░░░ 60% (6/10)')
    expect(out).toContain('Número sem WhatsApp')
    expect(out).toContain('+5511999990001')
    expect(out).toContain('10/01/2099')
  })

  it('handles finished, failed and long failure lists', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `r${i}`,
      contactId: `c${i}`,
      contactName: null,
      contactWaId: `55119999900${String(i).padStart(2, '0')}`,
      status: 'FAILED',
      errorMessage: null,
      sentAt: null,
    }))
    const failed = await domainHarness({ tty: true })
    failed.reply(ok(broadcast({ status: 'FAILED', recipients: many })))
    await failed.run('zap', 'broadcast', 'status', 'bc_1')
    expect(failed.out()).toContain('Falhou')
    expect(failed.out()).toContain('Mais 2 falhas')

    const done = await domainHarness({ tty: true })
    done.reply(
      ok(
        broadcast({
          status: 'DONE',
          recipientCount: 0,
          sentCount: 0,
          failedCount: 0,
          recipients: [],
        }),
      ),
    )
    await done.run('zap', 'broadcast', 'status', 'bc_1')
    expect(done.out()).toContain('Concluída')
    expect(done.out()).toContain('0%')
    expect(done.out()).not.toContain('CONTATO')
  })
})
