import { signPayload } from '@steel-so/sdk'
import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it } from 'vitest'
import { Dashboard } from '../src/tui/dashboard.js'
import { RowList } from '../src/tui/widgets.js'
import { formatMoney } from '../src/ui/labels.js'
import {
  clock,
  opportunity,
  page,
  pipelineList,
  template,
  ticket,
} from './domain-fixtures.js'
import {
  errResult,
  feed,
  KEY,
  type MockClient,
  mockClient,
  okResult,
  session,
  tick,
  waitFor,
} from './tui-fixtures.js'

const mounted: Array<{ unmount(): void }> = []
afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
})

function open(client: MockClient, initialTab = 0, overrides = {}) {
  const app = render(
    <Dashboard session={session(client, overrides)} initialTab={initialTab} />,
  )
  mounted.push(app)
  const frame = () => app.lastFrame() ?? ''
  // Ink re-subscribes key handlers in effects: give them a beat first.
  const press = async (...keys: string[]) => {
    await tick()
    for (const key of keys) {
      app.stdin.write(key)
      await tick()
    }
  }
  const type = async (text: string) => {
    await tick()
    for (const char of text) app.stdin.write(char)
    await tick()
  }
  return { app, frame, press, type }
}

const phase = (id: string, name: string, position: number) => ({
  id,
  name,
  color: null,
  category: 'IN_PROGRESS',
  completionPercent: position * 25,
  position,
})

function withQueue(client: MockClient) {
  client.servicedesk.tickets.list.mockResolvedValue(
    okResult(
      page([
        ticket(),
        ticket({
          id: 'tk_7',
          number: 7,
          code: 'INC-7',
          title: 'Impressora do 3º andar',
          phaseId: 'ph_work',
          phase: phase('ph_work', 'Em atendimento', 2),
          sla: {
            firstResponse: clock('breached', -20),
            resolution: clock('ok'),
          },
        }),
        ticket({
          id: 'tk_9',
          number: 9,
          code: 'REQ-9',
          title: 'Acesso ao ERP',
          type: 'SERVICE_REQUEST',
          priority: null,
          sla: {
            firstResponse: clock('met'),
            resolution: clock('at_risk', 15),
          },
        }),
      ]),
    ) as never,
  )
}

describe('dashboard shell', () => {
  it('shows the header, the tabs and my queue ordered by SLA risk', async () => {
    const client = mockClient()
    withQueue(client)
    const { frame } = open(client)
    await waitFor(() => expect(frame()).toContain('Minha fila'))
    const out = frame()
    expect(out).toContain('◆ Steel Demo (demo)')
    expect(out).toContain('Ana Souza · homologacao')
    expect(out).toContain('[1 ServiceDesk]')
    expect(out).toContain('3 chamados · 1 estourado(s) · 1 em risco')
    const lines = out.split('\n')
    const at = (code: string) => lines.findIndex((line) => line.includes(code))
    expect(at('INC-7')).toBeLessThan(at('REQ-9'))
    expect(at('REQ-9')).toBeLessThan(at('INC-42'))
    expect(lines[at('INC-7')]).toContain('› INC-7')
    expect(out).toContain('estourado (20 min atrás)')
    expect(out).toContain('? ajuda · q sai')
  })

  it('switches tabs with arrows, Tab and numbers, and toggles the help', async () => {
    const client = mockClient()
    const { frame, press } = open(client)
    await waitFor(() => expect(frame()).toContain('Fila limpa'))
    await press(KEY.right)
    await waitFor(() => expect(frame()).toContain('[2 CRM]'))
    await press(KEY.left, KEY.left)
    await waitFor(() => expect(frame()).toContain('[4 Webhooks]'))
    await press('3')
    await waitFor(() => expect(frame()).toContain('[3 Comunicação]'))
    await press(KEY.tab)
    await waitFor(() => expect(frame()).toContain('[4 Webhooks]'))
    await press('?')
    await waitFor(() => expect(frame()).toContain('Atalhos'))
    expect(frame()).toContain('troca de aba')
    await press('x')
    await waitFor(() => expect(frame()).not.toContain('Atalhos'))
    expect(frame()).toContain('[4 Webhooks]')
  })

  it('lists the token modules when some are missing', async () => {
    const client = mockClient()
    const { frame } = open(client, 0, { modules: ['CRM'] })
    await waitFor(() =>
      expect(frame()).toContain(
        'O token não tem acesso ao módulo ServiceDesk.',
      ),
    )
    expect(frame()).toContain('token com CRM')
    expect(frame()).toContain('Rode `steel login` e marque o módulo')
  })

  it('fits a narrow terminal by cutting the flexible column', () => {
    const app = render(
      <RowList
        columns={[
          { key: 'code', label: 'Código' },
          { key: 'title', label: 'Título', flex: true },
        ]}
        rows={[
          {
            id: '1',
            cells: { code: 'INC-1', title: 'Um título bem comprido demais' },
          },
        ]}
        selected={0}
        height={5}
        width={24}
      />,
    )
    mounted.push(app)
    const lines = (app.lastFrame() ?? '').split('\n')
    expect(lines[2]).toBe('› INC-1   Um título bem…')
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(
      24,
    )
  })

  it('pages long lists and keeps the cursor on screen', async () => {
    const client = mockClient()
    client.servicedesk.tickets.list.mockResolvedValue(
      okResult(
        page(
          Array.from({ length: 60 }, (_, i) =>
            ticket({ id: `t${i}`, number: i, code: `INC-${i}` }),
          ),
        ),
      ) as never,
    )
    const { frame, press } = open(client)
    await waitFor(() => expect(frame()).toContain('de 60'))
    await press(KEY.down, 'j', 'k')
    expect(frame()).toContain('› INC-1 ')
    await press('\u001B[F')
    await waitFor(() => expect(frame()).toContain('› INC-59'))
    await press('\u001B[H')
    await waitFor(() => expect(frame()).toContain('› INC-0 '))
    await press('\u001B[6~')
    await waitFor(() => expect(frame()).not.toContain('› INC-0 '))
    await press('\u001B[5~')
    await waitFor(() => expect(frame()).toContain('› INC-0 '))
  })
})

describe('ServiceDesk tab', () => {
  it('shows a loading line, then an empty queue', async () => {
    const client = mockClient()
    let release: () => void = () => {}
    client.servicedesk.tickets.list.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(okResult(page([])) as never)
        }),
    )
    const { frame } = open(client)
    await waitFor(() => expect(frame()).toContain('Carregando a sua fila…'))
    release()
    await waitFor(() =>
      expect(frame()).toContain('Nenhum chamado aberto com você. Fila limpa!'),
    )
  })

  it('shows 401 with the login hint and retries with r', async () => {
    const client = mockClient()
    client.servicedesk.tickets.list.mockResolvedValueOnce(
      errResult(401, 'UNAUTHORIZED') as never,
    )
    const { frame, press } = open(client)
    await waitFor(() =>
      expect(frame()).toContain('Token inválido, expirado ou revogado.'),
    )
    expect(frame()).toContain('Rode `steel login` para entrar de novo.')
    expect(frame()).toContain('r tenta de novo.')
    await press('r')
    await waitFor(() => expect(frame()).toContain('Fila limpa'))
    expect(client.servicedesk.tickets.list).toHaveBeenCalledTimes(2)
  })

  it('wraps an unexpected loader failure', async () => {
    const client = mockClient()
    client.servicedesk.tickets.list.mockRejectedValue(new Error('kaput'))
    const { frame } = open(client)
    await waitFor(() => expect(frame()).toContain('Erro inesperado no painel.'))
    expect(frame()).toContain('kaput')
  })

  it('filters with / and clears with Esc', async () => {
    const client = mockClient()
    withQueue(client)
    const { frame, press, type } = open(client)
    await waitFor(() => expect(frame()).toContain('INC-42'))
    await press('/')
    await waitFor(() => expect(frame()).toContain('Filtrar:'))
    await type('impressora')
    await waitFor(() => expect(frame()).not.toContain('INC-42'))
    expect(frame()).toContain('INC-7')
    await press(KEY.backspace)
    await press(KEY.enter)
    await waitFor(() => expect(frame()).toContain('Filtro: impressor'))
    await press('/')
    await type('zzz')
    await waitFor(() => expect(frame()).toContain('Nada encontrado para'))
    await press(KEY.escape)
    await waitFor(() => expect(frame()).toContain('INC-42'))
    expect(frame()).not.toContain('Filtro:')
  })

  it('opens the detail and posts a public comment after confirming', async () => {
    const client = mockClient()
    withQueue(client)
    client.servicedesk.tickets.comment.mockResolvedValue(
      okResult({ id: 'msg_1' }) as never,
    )
    const { frame, press, type } = open(client)
    await waitFor(() => expect(frame()).toContain('INC-7'))
    await press(KEY.enter)
    await waitFor(() => expect(frame()).toContain('Impressora do 3º andar'))
    expect(frame()).toContain('SLA resposta')
    expect(frame()).toContain('c comenta · m move de fase · Esc volta')
    // Tabs do not switch inside a detail.
    await press(KEY.right)
    expect(frame()).toContain('[1 ServiceDesk]')

    await press('c')
    await waitFor(() => expect(frame()).toContain('Comentário público:'))
    await type('Já reiniciei')
    await press(KEY.enter)
    await waitFor(() =>
      expect(frame()).toContain(
        'Publicar comentário público (o solicitante vê) no chamado INC-7? (s/N)',
      ),
    )
    await press('s')
    await waitFor(() =>
      expect(frame()).toContain(
        'Comentário público publicado no chamado INC-7.',
      ),
    )
    expect(client.servicedesk.tickets.comment).toHaveBeenCalledWith('tk_7', {
      body: 'Já reiniciei',
      visibility: 'PUBLIC',
    })
    // The queue reloads after a write.
    await waitFor(() =>
      expect(client.servicedesk.tickets.list).toHaveBeenCalledTimes(2),
    )
    await press(KEY.escape)
    await waitFor(() => expect(frame()).toContain('Minha fila'))
  })

  it('toggles an internal comment with Tab, and cancels on n or empty text', async () => {
    const client = mockClient()
    withQueue(client)
    client.servicedesk.tickets.comment.mockResolvedValue(
      errResult(403, 'FORBIDDEN', 'Escopo api:write necessário.') as never,
    )
    const { frame, press, type } = open(client)
    await waitFor(() => expect(frame()).toContain('INC-7'))
    await press(KEY.enter, 'c')
    await waitFor(() => expect(frame()).toContain('Tab: interno'))
    await press(KEY.enter)
    await waitFor(() => expect(frame()).toContain('c comenta'))

    await press('c', KEY.tab)
    await waitFor(() => expect(frame()).toContain('Comentário interno:'))
    await type('nota')
    await press(KEY.enter)
    await waitFor(() => expect(frame()).toContain('comentário interno'))
    await press('n')
    await waitFor(() => expect(frame()).toContain('c comenta'))
    expect(client.servicedesk.tickets.comment).not.toHaveBeenCalled()

    await press('c', KEY.tab)
    await type('nota')
    await press(KEY.enter, 'y')
    await waitFor(() =>
      expect(frame()).toContain('Escopo api:write necessário.'),
    )
    expect(frame()).toContain('Confira o escopo (api:write')
    expect(client.servicedesk.tickets.comment).toHaveBeenCalledWith('tk_7', {
      body: 'nota',
      visibility: 'INTERNAL',
    })
  })

  it('moves a ticket to a phase seen in the queue or typed by id', async () => {
    const client = mockClient()
    withQueue(client)
    client.servicedesk.tickets.move.mockResolvedValue(
      okResult(
        ticket({
          phase: phase('ph_work', 'Em atendimento', 2),
          completionPercent: 50,
        }),
      ) as never,
    )
    const { frame, press, type } = open(client)
    await waitFor(() => expect(frame()).toContain('INC-42'))
    await press(KEY.down, KEY.down, KEY.enter, 'm')
    await waitFor(() => expect(frame()).toContain('Mover INC-42 para'))
    expect(frame()).toContain('Em atendimento 50%')
    await press(KEY.down, KEY.up, KEY.enter)
    await waitFor(() =>
      expect(frame()).toContain(
        'Mover o chamado INC-42 para a fase Em atendimento? (s/N)',
      ),
    )
    await press(KEY.enter)
    await waitFor(() => expect(frame()).toContain('m move de fase'))
    expect(client.servicedesk.tickets.move).not.toHaveBeenCalled()

    await press('m', 'j', KEY.enter)
    await waitFor(() => expect(frame()).toContain('Id da fase de destino:'))
    await press(KEY.enter)
    await waitFor(() => expect(frame()).toContain('m move de fase'))

    await press('m', KEY.down, KEY.enter)
    await type('ph_x')
    await press(KEY.enter, 's')
    await waitFor(() =>
      expect(frame()).toContain('INC-42 agora está em Em atendimento (50%).'),
    )
    expect(client.servicedesk.tickets.move).toHaveBeenCalledWith('tk_1', {
      phaseId: 'ph_x',
    })

    await press('m')
    await waitFor(() => expect(frame()).toContain('Mover INC-42 para'))
    await press(KEY.escape)
    await waitFor(() => expect(frame()).toContain('m move de fase'))
  })

  it('asks for the phase id when the queue shows no other phase', async () => {
    const client = mockClient()
    client.servicedesk.tickets.list.mockResolvedValue(
      okResult(page([ticket()])) as never,
    )
    client.servicedesk.tickets.move.mockResolvedValue(
      okResult(ticket()) as never,
    )
    const { frame, press, type } = open(client)
    await waitFor(() => expect(frame()).toContain('INC-42'))
    await press(KEY.enter, 'm')
    await waitFor(() => expect(frame()).toContain('Id da fase de destino:'))
    await type('ph_done')
    await press(KEY.enter)
    await waitFor(() =>
      expect(frame()).toContain('Mover o chamado INC-42 para a fase ph_done?'),
    )
  })
})

describe('CRM tab', () => {
  function withBoard(client: MockClient) {
    client.crm.pipelines.mockResolvedValue(
      okResult(page(pipelineList)) as never,
    )
    client.crm.opportunities.list.mockResolvedValue(
      okResult(
        page([
          opportunity({ id: 'op_9', name: 'Beta', stageId: 'st_won' }),
          opportunity(),
          opportunity({
            id: 'op_r',
            name: 'Renova Acme',
            pipelineId: 'pl_renew',
            stageId: 'st_renew_prop',
            amount: null,
            probability: null,
            closeDate: null,
          }),
        ]),
      ) as never,
    )
  }

  it('groups opportunities by stage and switches pipelines with p', async () => {
    const client = mockClient()
    withBoard(client)
    const { frame, press } = open(client, 1)
    await waitFor(() =>
      expect(frame()).toContain('Vendas (1/3 · p troca o funil)'),
    )
    const out = frame()
    expect(out).toContain(`Proposta 1 · ${formatMoney(12500.5)}`)
    expect(out).toContain(`Ganho 1 · ${formatMoney(12500.5)}`)
    const lines = out.split('\n')
    const at = (text: string) => lines.findIndex((line) => line.includes(text))
    expect(at('Acme — 50 ramais')).toBeLessThan(at('Beta'))

    await press('p')
    await waitFor(() => expect(frame()).toContain('Renovação (2/3'))
    expect(frame()).toContain('Renova Acme')
    expect(frame()).toContain('—')
    await press('p')
    await waitFor(() =>
      expect(frame()).toContain('Nenhuma oportunidade neste funil.'),
    )
    await press('p')
    await waitFor(() => expect(frame()).toContain('Vendas (1/3'))
  })

  it('moves an opportunity to another stage after confirming', async () => {
    const client = mockClient()
    withBoard(client)
    client.crm.opportunities.move.mockResolvedValue(
      okResult(opportunity({ stageId: 'st_won' })) as never,
    )
    const { frame, press } = open(client, 1)
    await waitFor(() => expect(frame()).toContain('Acme — 50 ramais'))
    await press(KEY.enter)
    await waitFor(() => expect(frame()).toContain('Probabilidade'))
    expect(frame()).toContain('Funil')
    expect(frame()).toContain('01/02/2099')
    await press('m')
    await waitFor(() =>
      expect(frame()).toContain('Mover Acme — 50 ramais para'),
    )
    expect(frame()).toContain('Ganho 100%')
    await press(KEY.enter)
    await waitFor(() =>
      expect(frame()).toContain(
        'Mover a oportunidade Acme — 50 ramais para Vendas › Ganho? (s/N)',
      ),
    )
    await press('s')
    await waitFor(() =>
      expect(frame()).toContain(
        'Acme — 50 ramais agora está em Vendas › Ganho.',
      ),
    )
    expect(client.crm.opportunities.move).toHaveBeenCalledWith('op_1', {
      stageId: 'st_won',
      pipelineId: 'pl_sales',
    })
  })

  it('says when there is no other stage to move to', async () => {
    const client = mockClient()
    withBoard(client)
    const { frame, press } = open(client, 1)
    await waitFor(() => expect(frame()).toContain('Vendas (1/3'))
    await press('p')
    await waitFor(() => expect(frame()).toContain('Renova Acme'))
    await press(KEY.enter)
    await waitFor(() => expect(frame()).toContain('Probabilidade'))
    await press('m')
    await waitFor(() =>
      expect(frame()).toContain('Não há outra etapa neste funil.'),
    )
    await press(KEY.escape)
    await waitFor(() => expect(frame()).toContain('Renovação (2/3'))
  })

  it('shows when there is no pipeline', async () => {
    const client = mockClient()
    const { frame } = open(client, 1)
    await waitFor(() => expect(frame()).toContain('Nenhum funil configurado.'))
  })
})

describe('Comunicação tab', () => {
  it('lists approved templates, says conversations are not in the API yet', async () => {
    const client = mockClient()
    client.whatsapp.templates.mockResolvedValue(
      okResult(
        page([
          template(),
          template({ id: 'tpl_2', name: 'cobranca', quality: 'RED' }),
        ]),
      ) as never,
    )
    const { frame, press, type } = open(client, 2)
    await waitFor(() => expect(frame()).toContain('boas_vindas'))
    expect(frame()).toContain('Templates aprovados')
    expect(frame()).toContain('ainda não estão na API v1')
    expect(frame()).toContain('Baixa')
    await press(KEY.enter)
    await waitFor(() => expect(frame()).toContain('Olá {{1}}, seu código é'))
    expect(frame()).toContain('steel zap send --template boas_vindas')
    await press(KEY.escape)
    await waitFor(() => expect(frame()).toContain('cobranca'))
    await press('/')
    await type('cobr')
    await waitFor(() => expect(frame()).not.toContain('boas_vindas'))
  })

  it('shows the template detail without text', async () => {
    const client = mockClient()
    client.whatsapp.templates.mockResolvedValue(
      okResult(page([template({ components: [] })])) as never,
    )
    const { frame, press } = open(client, 2)
    await waitFor(() => expect(frame()).toContain('boas_vindas'))
    await press(KEY.enter)
    await waitFor(() => expect(frame()).toContain('(sem texto)'))
  })
})

describe('Webhooks tab', () => {
  const secret = 'whsec_test'
  const frameFor = (id: string, type: string, sign = true) => {
    const body = JSON.stringify({
      id,
      type,
      createdAt: '2099-01-10T12:00:05.000Z',
      workspaceId: 'ws_1',
      data: { leadId: 'ld_1' },
    })
    const timestamp = 4070000000
    return {
      type: 'webhook' as const,
      frame: {
        id,
        body,
        timestamp,
        signature: sign ? signPayload(secret, timestamp, body) : 'v1=bad',
      },
      event: JSON.parse(body),
    }
  }

  it('tails events live, shows the body and keeps running across tabs', async () => {
    const client = mockClient()
    const stream = feed()
    client.webhooks.listen.mockResolvedValue(okResult(stream.iterable) as never)
    const { frame, press, type } = open(client, 3)
    await waitFor(() => expect(frame()).toContain('Conectando ao Steel…'))
    stream.push({
      type: 'ready',
      ready: { workspaceId: 'ws_1', events: [], secret },
    })
    await waitFor(() => expect(frame()).toContain('Aguardando eventos…'))
    expect(frame()).toContain('Nenhum evento ainda.')
    stream.push(frameFor('evt_1', 'crm.lead.created'))
    await waitFor(() => expect(frame()).toContain('evt_1'))
    expect(frame()).toContain('12:00:05')
    expect(frame()).toContain('1 recebido')

    await press('1')
    stream.push(frameFor('evt_2', 'crm.deal.won', false))
    await press('4')
    await waitFor(() => expect(frame()).toContain('crm.deal.won'))
    expect(frame()).toContain('inválida')
    const lines = frame().split('\n')
    expect(lines.findIndex((line) => line.includes('evt_2'))).toBeLessThan(
      lines.findIndex((line) => line.includes('evt_1')),
    )

    await press(KEY.down)
    stream.push(frameFor('evt_3', 'servicedesk.ticket.created'))
    await waitFor(() => expect(frame()).toContain('evt_3'))
    expect(frame()).toContain('› ')
    expect(
      frame()
        .split('\n')
        .find((line) => line.includes('›')),
    ).toContain('evt_1')
    await press(KEY.up, KEY.up, KEY.enter)
    await waitFor(() => expect(frame()).toContain('"leadId"'))
    await press(KEY.escape, KEY.down, KEY.enter)
    await waitFor(() =>
      expect(frame()).toContain(
        'Assinatura inválida para o segredo da escuta.',
      ),
    )
    await press(KEY.escape)

    await press('/')
    await waitFor(() => expect(frame()).toContain('tipo ou id do evento'))
    await type('deal')
    await waitFor(() => expect(frame()).not.toContain('evt_1'))
    await press(KEY.enter)
    await waitFor(() => expect(frame()).toContain('Filtro: deal'))
    await press('/')
    await type('nada')
    await waitFor(() => expect(frame()).toContain('Nenhum evento com'))
    await press(KEY.escape)
    await waitFor(() => expect(frame()).toContain('evt_1'))
    expect(client.webhooks.listen).toHaveBeenCalledTimes(1)
  })

  it('reconnects after a drop or a transient error, and restarts on r', async () => {
    const client = mockClient()
    const first = feed()
    const second = feed()
    const third = feed()
    client.webhooks.listen
      .mockResolvedValueOnce(okResult(first.iterable) as never)
      .mockResolvedValueOnce(errResult(0, 'NETWORK_ERROR') as never)
      .mockResolvedValueOnce(errResult(503, 'HTTP_ERROR') as never)
      .mockResolvedValueOnce(okResult(second.iterable) as never)
      .mockResolvedValueOnce(okResult(third.iterable) as never)
    const { frame, press } = open(client, 3)
    await waitFor(() => expect(client.webhooks.listen).toHaveBeenCalledTimes(1))
    first.push({
      type: 'ready',
      ready: { workspaceId: 'ws_1', events: [], secret },
    })
    first.push({ type: 'disconnected', reason: 'idle' })
    await waitFor(() => expect(client.webhooks.listen).toHaveBeenCalledTimes(4))
    second.push({
      type: 'ready',
      ready: { workspaceId: 'ws_1', events: [], secret },
    })
    second.push(frameFor('evt_1', 'crm.lead.created'))
    await waitFor(() => expect(frame()).toContain('evt_1'))
    second.push({ type: 'disconnected', reason: 'network' })
    await waitFor(() => expect(client.webhooks.listen).toHaveBeenCalledTimes(5))
    third.push({
      type: 'ready',
      ready: { workspaceId: 'ws_1', events: [], secret },
    })

    const fourth = feed()
    client.webhooks.listen.mockResolvedValueOnce(
      okResult(fourth.iterable) as never,
    )
    await press('r')
    await waitFor(() => expect(client.webhooks.listen).toHaveBeenCalledTimes(6))
    await waitFor(() => expect(frame()).not.toContain('evt_1'))
  })

  it('stops on 403 with the OWNER/ADMIN hint, and on 401 with the login hint', async () => {
    const client = mockClient()
    client.webhooks.listen.mockResolvedValueOnce(
      errResult(403, 'FORBIDDEN') as never,
    )
    const { frame, press } = open(client, 3)
    await waitFor(() =>
      expect(frame()).toContain('Sem permissão para escutar os eventos.'),
    )
    expect(frame()).toContain('OWNER/ADMIN')
    client.webhooks.listen.mockResolvedValueOnce(
      errResult(401, 'UNAUTHORIZED') as never,
    )
    await press('r')
    await waitFor(() =>
      expect(frame()).toContain('Rode `steel login` para entrar de novo.'),
    )
  })

  it('shows the reconnect countdown from Retry-After', async () => {
    const client = mockClient()
    let release: () => void = () => {}
    const s = session(client)
    s.sleep = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
    client.webhooks.listen.mockResolvedValueOnce({
      ok: false,
      error: { status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 7 },
    } as never)
    const app = render(<Dashboard session={s} initialTab={3} />)
    mounted.push(app)
    await waitFor(() =>
      expect(app.lastFrame()).toContain('Reconectando em 7 s…'),
    )
    expect(app.lastFrame()).toContain('HTTP 429')
    release()
  })
})
