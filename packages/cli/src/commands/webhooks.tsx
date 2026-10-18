import type {
  WebhookDelivery,
  WebhookDeliveryStatus,
  WebhookEndpoint,
} from '@steel-so/sdk'
import { Text } from 'ink'
import type { Context } from '../context.js'
import { CliError, EXIT, fromSteelError, usageError } from '../errors.js'
import { formatDate } from '../lib/format.js'
import {
  Code,
  Hint,
  KeyValue,
  Success,
  Table,
  Warning,
} from '../ui/components.js'
import { moduleLabel, theme } from '../ui/theme.js'
import { parseEventList } from './listen.js'

export const DELIVERY_STATUSES: readonly WebhookDeliveryStatus[] = [
  'PENDING',
  'SUCCEEDED',
  'RETRYING',
  'FAILED',
  'SKIPPED',
]

const DELIVERY_LABELS: Record<WebhookDeliveryStatus, string> = {
  PENDING: 'na fila',
  SUCCEEDED: 'entregue',
  RETRYING: 'tentando de novo',
  FAILED: 'falhou',
  SKIPPED: 'ignorada',
}

const EVENT_MODULE_LABELS: Record<string, string> = {
  AGENTS: 'Agentes',
  PLATFORM: 'Plataforma',
}

/** Max page size of the deliveries log (contract). */
const PAGE_MAX = 100

async function authed(ctx: Context) {
  const target = await ctx.authTarget()
  return { target, webhooks: ctx.client(target, target.token).webhooks }
}

function eventsLabel(events: string[]): string {
  if (events.includes('*')) return 'todos'
  if (events.length <= 2) return events.join(', ')
  return `${events.slice(0, 2).join(', ')} +${events.length - 2}`
}

export function endpointState(endpoint: WebhookEndpoint, timeZone?: string) {
  if (!endpoint.active) {
    return endpoint.disabledReason === 'auto'
      ? 'desativado (3 dias falhando)'
      : 'desativado'
  }
  if (endpoint.failingSince) {
    return `falhando desde ${formatDate(endpoint.failingSince, timeZone)}`
  }
  return 'ativo'
}

function deliveryOutcome(delivery: WebhookDelivery): string {
  if (delivery.responseStatus !== null) return String(delivery.responseStatus)
  return delivery.error ?? '—'
}

export async function webhooksEvents(ctx: Context) {
  const { target, webhooks } = await authed(ctx)
  const result = await webhooks.events()
  if (!result.ok) throw fromSteelError(result.error, target.url)
  if (ctx.json) {
    ctx.printJson(result.data)
    return
  }
  ctx.render(
    <Table
      columns={[
        { key: 'type', label: 'Tipo' },
        { key: 'module', label: 'Módulo' },
        { key: 'description', label: 'Descrição' },
      ]}
      rows={result.data.map((event) => ({
        type: event.type,
        module: EVENT_MODULE_LABELS[event.module] ?? moduleLabel(event.module),
        description: event.subscribable
          ? event.description
          : `${event.description} (só sob demanda)`,
      }))}
    />,
  )
}

export async function endpointsList(ctx: Context) {
  const { target, webhooks } = await authed(ctx)
  const result = await webhooks.listEndpoints()
  if (!result.ok) throw fromSteelError(result.error, target.url)
  const { items } = result.data
  if (ctx.json) {
    ctx.printJson(result.data)
    return
  }
  if (items.length === 0) {
    ctx.render(
      <>
        <Text>Nenhum endpoint cadastrado.</Text>
        <Hint>
          Cadastre com{' '}
          <Code>
            steel webhooks endpoints create --url https://… --events *
          </Code>
          .
        </Hint>
      </>,
    )
    return
  }
  ctx.render(
    <Table
      columns={[
        { key: 'id', label: 'ID' },
        { key: 'url', label: 'URL' },
        { key: 'events', label: 'Eventos' },
        { key: 'state', label: 'Estado' },
        { key: 'secret', label: 'Segredo' },
      ]}
      rows={items.map((endpoint) => ({
        id: endpoint.id,
        url: endpoint.url,
        events: eventsLabel(endpoint.events),
        state: endpointState(endpoint, ctx.deps.timeZone),
        secret: endpoint.secretHint,
      }))}
    />,
  )
}

export interface CreateEndpointOptions {
  url: string
  events: string
  description?: string
  active: boolean
}

export async function endpointsCreate(
  ctx: Context,
  options: CreateEndpointOptions,
) {
  const all = /(^|[\s,])\*([\s,]|$)/.test(options.events)
  const events = all ? ['*'] : parseEventList(options.events)
  if (events.length === 0) {
    throw usageError(
      'Informe ao menos um evento em --events.',
      'Use --events "*" para todos ou veja os tipos com `steel webhooks events`.',
    )
  }
  const { target, webhooks } = await authed(ctx)
  const result = await webhooks.createEndpoint({
    url: options.url,
    events,
    ...(options.description ? { description: options.description } : {}),
    ...(options.active ? {} : { active: false }),
  })
  if (!result.ok) throw fromSteelError(result.error, target.url)
  const { endpoint, secret } = result.data
  if (ctx.json) {
    ctx.printJson(result.data)
    return
  }
  ctx.render(
    <>
      <Success>Endpoint cadastrado.</Success>
      <KeyValue
        rows={[
          ['ID', endpoint.id],
          ['URL', endpoint.url],
          ['Eventos', eventsLabel(endpoint.events)],
          ['Estado', endpointState(endpoint, ctx.deps.timeZone)],
          ['Segredo', <Code key='s'>{secret}</Code>],
        ]}
      />
      <Warning>
        Guarde o segredo agora: ele não aparece de novo por aqui.
      </Warning>
      <Hint>
        Teste com <Code>steel webhooks endpoints test {endpoint.id}</Code>.
      </Hint>
    </>,
  )
}

export async function endpointsDelete(
  ctx: Context,
  id: string,
  options: { yes?: boolean },
) {
  if (!options.yes) {
    const confirm = ctx.json ? undefined : ctx.deps.confirm
    if (!confirm) {
      throw usageError(
        'Remover um endpoint precisa de confirmação.',
        'Fora de um terminal interativo, passe --yes.',
      )
    }
    const accepted = await confirm(
      `Remover o endpoint ${id}? As entregas pendentes serão descartadas.`,
    )
    if (!accepted) {
      throw new CliError('Nada foi removido.', {
        code: 'CANCELLED',
        exitCode: EXIT.CANCELLED,
      })
    }
  }
  const { target, webhooks } = await authed(ctx)
  const result = await webhooks.deleteEndpoint(id)
  if (!result.ok) throw fromSteelError(result.error, target.url)
  if (ctx.json) {
    ctx.printJson({ id: result.data.id, deleted: true })
    return
  }
  ctx.render(<Success>Endpoint {result.data.id} removido.</Success>)
}

export async function endpointsTest(ctx: Context, id: string) {
  const { target, webhooks } = await authed(ctx)
  const result = await webhooks.testEndpoint(id)
  if (!result.ok) throw fromSteelError(result.error, target.url)
  const delivery = result.data
  const succeeded = delivery.status === 'SUCCEEDED'
  if (ctx.json) {
    ctx.printJson(delivery)
    return succeeded ? EXIT.OK : EXIT.ERROR
  }
  const took =
    delivery.durationMs === null ? '' : ` em ${delivery.durationMs} ms`
  ctx.render(
    succeeded ? (
      <Success>
        steel.ping entregue: {delivery.responseStatus}
        {took}.
      </Success>
    ) : (
      <>
        <Warning>
          O endpoint não confirmou o steel.ping: {deliveryOutcome(delivery)}
          {took}.
        </Warning>
        {delivery.responseBody ? (
          <Text color={theme.muted}>
            {'  '}
            {delivery.responseBody}
          </Text>
        ) : null}
        <Hint>Só respostas 2xx confirmam a entrega.</Hint>
      </>
    ),
  )
  return succeeded ? EXIT.OK : EXIT.ERROR
}

export interface DeliveriesListOptions {
  endpoint?: string
  status?: string
  limit?: string
  cursor?: string
  all?: boolean
}

function parseLimit(input?: string): number | undefined {
  if (input === undefined) return undefined
  const limit = Number(input)
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_MAX) {
    throw usageError(`--limit precisa ser um número de 1 a ${PAGE_MAX}.`)
  }
  return limit
}

function parseStatus(input?: string): WebhookDeliveryStatus | undefined {
  if (input === undefined) return undefined
  const status = input.toUpperCase() as WebhookDeliveryStatus
  if (!DELIVERY_STATUSES.includes(status)) {
    throw usageError(
      `Estado inválido: ${input}`,
      `Use ${DELIVERY_STATUSES.join(', ')}.`,
    )
  }
  return status
}

export async function deliveriesList(
  ctx: Context,
  options: DeliveriesListOptions,
) {
  const limit = parseLimit(options.limit)
  const status = parseStatus(options.status)
  const { target, webhooks } = await authed(ctx)
  const items: WebhookDelivery[] = []
  let cursor = options.cursor
  let nextCursor: string | null = null
  do {
    const result = await webhooks.listDeliveries({
      ...(options.endpoint ? { endpointId: options.endpoint } : {}),
      ...(status ? { status } : {}),
      ...(options.all ? { limit: PAGE_MAX } : limit ? { limit } : {}),
      ...(cursor ? { cursor } : {}),
    })
    if (!result.ok) throw fromSteelError(result.error, target.url)
    items.push(...result.data.items)
    nextCursor = result.data.nextCursor
    cursor = nextCursor ?? undefined
  } while (options.all && nextCursor)

  if (ctx.json) {
    ctx.printJson({ items, nextCursor })
    return
  }
  if (items.length === 0) {
    ctx.render(<Text>Nenhuma entrega nos últimos 30 dias.</Text>)
    return
  }
  ctx.render(
    <>
      <Table
        columns={[
          { key: 'id', label: 'ID' },
          { key: 'event', label: 'Evento' },
          { key: 'status', label: 'Estado' },
          { key: 'outcome', label: 'Resposta' },
          { key: 'duration', label: 'Tempo' },
          { key: 'attempts', label: 'Tent.' },
          { key: 'at', label: 'Quando' },
        ]}
        rows={items.map((delivery) => ({
          id: delivery.id,
          event: delivery.eventType,
          status: DELIVERY_LABELS[delivery.status] ?? delivery.status,
          outcome: deliveryOutcome(delivery),
          duration:
            delivery.durationMs === null ? '—' : `${delivery.durationMs} ms`,
          attempts: String(delivery.attempts),
          at: formatDate(
            delivery.lastAttemptAt ?? delivery.createdAt,
            ctx.deps.timeZone,
          ),
        }))}
      />
      {nextCursor ? (
        <Hint>
          Há mais entregas: <Code>--cursor {nextCursor}</Code> ou{' '}
          <Code>--all</Code>.
        </Hint>
      ) : null}
    </>,
  )
}

export async function deliveriesRetry(ctx: Context, id: string) {
  const { target, webhooks } = await authed(ctx)
  const result = await webhooks.retryDelivery(id)
  if (!result.ok) throw fromSteelError(result.error, target.url)
  if (ctx.json) {
    ctx.printJson(result.data)
    return
  }
  ctx.render(
    <>
      <Success>
        Reenvio da entrega {result.data.id} ({result.data.eventType}) na fila.
      </Success>
      <Hint>
        Acompanhe com{' '}
        <Code>
          steel webhooks deliveries list --endpoint {result.data.endpointId}
        </Code>
        .
      </Hint>
    </>,
  )
}
