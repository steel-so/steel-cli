import type {
  SdCatalogItem,
  SdTicket,
  SdTicketCreate,
  SdTicketType,
} from '@steel-so/sdk'
import { Box, Text } from 'ink'
import type { Context } from '../context.js'
import { usageError } from '../errors.js'
import {
  confirmWrite,
  fetchAll,
  fetchPages,
  type PageOptions,
  parseEnum,
  readTextArg,
  required,
  splitList,
  truncate,
  unwrap,
} from '../lib/domain.js'
import { formatDate } from '../lib/format.js'
import { Code, Hint, KeyValue, Success, Table } from '../ui/components.js'
import {
  CATALOG_LEVEL_LABELS,
  formatMinutes,
  label,
  PHASE_CATEGORIES,
  SLA_STATE_LABELS,
  TICKET_TYPE_LABELS,
  TICKET_TYPES,
} from '../ui/labels.js'
import { printPage } from '../ui/page.js'
import { theme } from '../ui/theme.js'

type Clock = SdTicket['sla']['resolution']

export function slaText(clock: Clock): string {
  const state = label(SLA_STATE_LABELS, clock.state)
  if (
    clock.remainingMinutes === null ||
    clock.state === 'met' ||
    clock.state === 'none'
  ) {
    return state
  }
  return `${state} (${formatMinutes(clock.remainingMinutes)})`
}

export function slaColor(clock: Clock): string | undefined {
  if (clock.state === 'breached') return theme.danger
  if (clock.state === 'at_risk') return theme.warning
  if (clock.state === 'ok' || clock.state === 'met') return theme.success
  return undefined
}

function parseType(value: string | undefined): SdTicketType | undefined {
  return parseEnum(value ? [value] : undefined, TICKET_TYPES, '--type')?.[0]
}

/* ------------------------------------------------------------------ */

export interface TicketListOptions extends PageOptions {
  status?: string[]
  type?: string[]
  phase?: string[]
  priority?: string[]
  assignee?: string[]
  search?: string
}

export async function ticketList(ctx: Context, options: TicketListOptions) {
  const status = parseEnum(options.status, PHASE_CATEGORIES, '--status')
  const type = parseEnum(options.type, TICKET_TYPES, '--type')
  const target = await ctx.authTarget()
  const sd = ctx.client(target, target.token).servicedesk
  const page = await fetchPages(target, options, (query) =>
    sd.tickets.list({
      ...query,
      status,
      type,
      phaseId: splitList(options.phase),
      priorityId: splitList(options.priority),
      assigneeId: splitList(options.assignee),
      q: options.search,
    }),
  )

  printPage(ctx, page, {
    command: 'steel sd ticket list',
    empty: 'Nenhum chamado encontrado com esses filtros.',
    table: (tickets) => (
      <Table
        columns={[
          { key: 'code', label: 'Código' },
          { key: 'title', label: 'Título' },
          { key: 'type', label: 'Tipo' },
          { key: 'phase', label: 'Fase' },
          { key: 'priority', label: 'Prioridade' },
          { key: 'assignee', label: 'Responsável' },
          { key: 'sla', label: 'SLA' },
        ]}
        rows={tickets.map((ticket) => ({
          code: ticket.code,
          title: truncate(ticket.title, 44),
          type: label(TICKET_TYPE_LABELS, ticket.type),
          phase: ticket.phase.name,
          priority: ticket.priority?.name ?? '—',
          assignee: ticket.assignee ? truncate(ticket.assignee.name, 20) : '—',
          sla: slaText(ticket.sla.resolution),
          breached: ticket.sla.resolution.state === 'breached' ? '1' : '',
        }))}
        highlight={(row) => row.breached === '1'}
      />
    ),
  })
}

/* ------------------------------------------------------------------ */

function TicketDetail({
  ticket,
  timeZone,
}: {
  ticket: SdTicket
  timeZone?: string
}) {
  const catalog = [ticket.category, ticket.subcategory, ticket.service]
    .filter((item) => item !== null)
    .map((item) => item.name)
    .join(' › ')
  const date = (iso: string | null) => (iso ? formatDate(iso, timeZone) : '—')
  return (
    <Box flexDirection='column'>
      <Text>
        <Text color={theme.brand} bold>
          {ticket.code}
        </Text>{' '}
        <Text bold>{ticket.title}</Text>
      </Text>
      <Text> </Text>
      <KeyValue
        rows={[
          ['Tipo', label(TICKET_TYPE_LABELS, ticket.type)],
          ['Fase', `${ticket.phase.name} · ${ticket.completionPercent}%`],
          ['Prioridade', ticket.priority?.name ?? '—'],
          ['Catálogo', catalog || '—'],
          ['Responsável', ticket.assignee?.name ?? '—'],
          [
            'Solicitante',
            ticket.requester
              ? `${ticket.requester.name} <${ticket.requester.email}>`
              : '—',
          ],
          [
            'SLA resposta',
            <Text key='r' color={slaColor(ticket.sla.firstResponse)}>
              {slaText(ticket.sla.firstResponse)}
            </Text>,
          ],
          [
            'SLA solução',
            <Text key='s' color={slaColor(ticket.sla.resolution)}>
              {slaText(ticket.sla.resolution)}
            </Text>,
          ],
          ['Tags', ticket.tags.join(', ') || '—'],
          ['Aberto em', date(ticket.createdAt)],
          ['Atualizado', date(ticket.lastActivityAt)],
          ...(ticket.closedAt
            ? ([['Fechado em', date(ticket.closedAt)]] as Array<
                [string, string]
              >)
            : []),
        ]}
      />
      {ticket.description ? (
        <>
          <Text> </Text>
          <Text>{ticket.description.trim()}</Text>
        </>
      ) : null}
    </Box>
  )
}

export async function ticketView(ctx: Context, ticketId: string) {
  const target = await ctx.authTarget()
  const ticket = unwrap(
    await ctx.client(target, target.token).servicedesk.tickets.get(ticketId),
    target,
  )
  if (ctx.json) {
    ctx.printJson(ticket)
    return
  }
  ctx.render(<TicketDetail ticket={ticket} timeZone={ctx.deps.timeZone} />)
}

/* ------------------------------------------------------------------ */

export interface TicketCreateOptions {
  type?: string
  title?: string
  description?: string
  service?: string
  category?: string
  subcategory?: string
  priority?: string
  assignee?: string
  tag?: string[]
  yes?: boolean
}

const NO_SERVICE = '__none__'

async function pickService(
  ctx: Context,
  items: SdCatalogItem[],
): Promise<string | undefined> {
  const services = items.filter((item) => item.level === 'SERVICE')
  if (services.length === 0) return undefined
  const names = new Map(items.map((item) => [item.id, item.name]))
  const path = (item: SdCatalogItem) => {
    const parent = item.parentId ? names.get(item.parentId) : undefined
    return parent ? `${parent} › ${item.name}` : item.name
  }
  const choice = await ctx.prompt.select('Serviço do catálogo', [
    ...services.map((item) => ({ value: item.id, label: path(item) })),
    { value: NO_SERVICE, label: 'Nenhum (sem serviço)' },
  ])
  return choice === NO_SERVICE ? undefined : choice
}

export async function ticketCreate(ctx: Context, options: TicketCreateOptions) {
  const target = await ctx.authTarget()
  const sd = ctx.client(target, target.token).servicedesk
  const askedFor = !options.type || !options.title

  const type = await required(
    ctx,
    parseType(options.type),
    '--type',
    () =>
      ctx.prompt.select<SdTicketType>(
        'Tipo do chamado',
        (Object.keys(TICKET_TYPES) as SdTicketType[]).map((value) => ({
          value,
          label: label(TICKET_TYPE_LABELS, value),
        })),
      ),
    'Use --type incidente, requisicao, mudanca ou problema.',
  )
  const title = await required(ctx, options.title, '--title', () =>
    ctx.prompt.text('Título', { required: true }),
  )
  let description =
    options.description === undefined
      ? undefined
      : await readTextArg(ctx, options.description)
  let serviceId = options.service
  if (askedFor && ctx.interactive) {
    if (description === undefined) {
      description = (await ctx.prompt.text('Descrição (opcional)')) || undefined
    }
    if (!serviceId && !options.category) {
      const catalog = await fetchAll(target, (query) =>
        sd.catalog({ ...query, ticketType: type }),
      )
      serviceId = await pickService(ctx, catalog.items)
    }
  }

  const body: SdTicketCreate = {
    type,
    title,
    ...(description ? { description } : {}),
    ...(serviceId ? { serviceId } : {}),
    ...(options.category ? { categoryId: options.category } : {}),
    ...(options.subcategory ? { subcategoryId: options.subcategory } : {}),
    ...(options.priority ? { priorityId: options.priority } : {}),
    ...(options.assignee ? { assigneeId: options.assignee } : {}),
    ...(splitList(options.tag) ? { tags: splitList(options.tag) } : {}),
  }
  await confirmWrite(
    ctx,
    options.yes,
    `Abrir ${label(TICKET_TYPE_LABELS, type).toLowerCase()} “${title}”?`,
  )
  const ticket = unwrap(await sd.tickets.create(body), target)
  if (ctx.json) {
    ctx.printJson(ticket)
    return
  }
  ctx.render(
    <>
      <Success>
        Chamado {ticket.code} aberto na fase {ticket.phase.name}.
      </Success>
      <Hint>
        Veja com <Code>steel sd ticket view {ticket.number}</Code>.
      </Hint>
    </>,
  )
}

/* ------------------------------------------------------------------ */

export interface TicketCommentOptions {
  message?: string
  internal?: boolean
  yes?: boolean
}

export async function ticketComment(
  ctx: Context,
  ticketId: string,
  options: TicketCommentOptions,
) {
  const target = await ctx.authTarget()
  const raw = await required(
    ctx,
    options.message,
    '--message',
    () => ctx.prompt.text('Comentário', { required: true }),
    'Use -m "texto", -m @arquivo.md ou -m @- (stdin).',
  )
  const body = (await readTextArg(ctx, raw)).trim()
  if (!body) throw usageError('O comentário está vazio.')
  const visibility = options.internal ? 'INTERNAL' : 'PUBLIC'
  await confirmWrite(
    ctx,
    options.yes,
    `Publicar comentário ${options.internal ? 'interno' : 'público (o solicitante vê)'} no chamado ${ticketId}?`,
  )
  const message = unwrap(
    await ctx
      .client(target, target.token)
      .servicedesk.tickets.comment(ticketId, { body, visibility }),
    target,
  )
  if (ctx.json) {
    ctx.printJson(message)
    return
  }
  ctx.render(
    <Success>
      Comentário {options.internal ? 'interno' : 'público'} publicado no chamado{' '}
      {ticketId}.
    </Success>,
  )
}

/* ------------------------------------------------------------------ */

export interface TicketMoveOptions {
  phase?: string
  solution?: string
  comment?: string
  yes?: boolean
}

export async function ticketMove(
  ctx: Context,
  ticketId: string,
  options: TicketMoveOptions,
) {
  const target = await ctx.authTarget()
  const phaseId = await required(
    ctx,
    options.phase,
    '--phase',
    () => ctx.prompt.text('Id da fase de destino', { required: true }),
    'Informe o id da fase com --phase (veja `steel sd ticket view <id> --json`).',
  )
  const solution =
    options.solution === undefined
      ? undefined
      : await readTextArg(ctx, options.solution)
  await confirmWrite(
    ctx,
    options.yes,
    `Mover o chamado ${ticketId} para a fase ${phaseId}?`,
  )
  const ticket = unwrap(
    await ctx.client(target, target.token).servicedesk.tickets.move(ticketId, {
      phaseId,
      ...(solution ? { solution } : {}),
      ...(options.comment ? { comment: options.comment } : {}),
    }),
    target,
  )
  if (ctx.json) {
    ctx.printJson(ticket)
    return
  }
  ctx.render(
    <Success>
      {ticket.code} agora está em {ticket.phase.name} (
      {ticket.completionPercent}%).
    </Success>,
  )
}

/* ------------------------------------------------------------------ */

export interface CatalogOptions extends PageOptions {
  type?: string
}

const DEPTH: Record<string, number> = {
  CATEGORY: 0,
  SUBCATEGORY: 1,
  SERVICE: 2,
}

export async function catalog(ctx: Context, options: CatalogOptions) {
  const ticketType = parseType(options.type)
  const target = await ctx.authTarget()
  const sd = ctx.client(target, target.token).servicedesk
  const page = await fetchPages(target, options, (query) =>
    sd.catalog({ ...query, ...(ticketType ? { ticketType } : {}) }),
  )
  printPage(ctx, page, {
    command: 'steel sd catalog',
    empty: 'O catálogo está vazio.',
    table: (items) => (
      <Table
        columns={[
          { key: 'name', label: 'Nome' },
          { key: 'level', label: 'Nível' },
          { key: 'types', label: 'Tipos' },
          { key: 'id', label: 'Id' },
        ]}
        rows={items.map((item) => ({
          name: `${'  '.repeat(DEPTH[item.level] ?? 0)}${truncate(item.name, 40)}${item.active ? '' : ' (inativo)'}`,
          level: label(CATALOG_LEVEL_LABELS, item.level),
          types:
            item.ticketTypes
              .map((type) => label(TICKET_TYPE_LABELS, type))
              .join(', ') || 'todos',
          id: item.id,
        }))}
      />
    ),
  })
}
