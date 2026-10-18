import { type SteelError, verifySignature } from '@steel-so/sdk'
import { Box, Text, useInput } from 'ink'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CliError, fromSteelError } from '../errors.js'
import { abortableSleep, reconnectDelayMs } from '../lib/sleep.js'
import { formatJson } from '../ui/json.js'
import {
  formatClock,
  type ListenStatus,
  ListenStatusLine,
} from '../ui/listen.js'
import { symbols, theme } from '../ui/theme.js'
import { type DashboardSession, matchesFilter } from './data.js'
import type { TabMode, TabProps } from './list-tab.js'
import { Empty, ErrorState, RowList, TextInput } from './widgets.js'

/** Events kept on screen; older ones drop off. */
export const TAIL_LIMIT = 200

export interface TailEvent {
  id: string
  type: string
  at: string
  verified: boolean
  body: string
}

export interface TailHandlers {
  onEvent(event: TailEvent): void
  onStatus(status: ListenStatus): void
  /** A failure reconnecting cannot fix (401, 403, bad filter). */
  onFatal(error: CliError): void
}

function isFatal(error: SteelError): boolean {
  return [400, 401, 403, 404, 422].includes(error.status)
}

function fatalError(error: SteelError, url: string): CliError {
  if (error.code === 'FORBIDDEN') {
    return new CliError(
      error.message ?? 'Sem permissão para escutar os eventos.',
      {
        code: error.code,
        hint: 'A escuta de webhooks é para OWNER/ADMIN do workspace; confira o token com `steel whoami`.',
      },
    )
  }
  return fromSteelError(error, url)
}

/**
 * The `steel listen` loop for the dashboard: same SDK stream, signature
 * check and backoff, without forwarding. Resolves when `signal` aborts or
 * on a fatal error.
 */
export async function tailWebhooks(
  session: DashboardSession,
  signal: AbortSignal,
  handlers: TailHandlers,
): Promise<void> {
  const sleep = session.sleep ?? abortableSleep
  let attempt = 0
  let received = 0
  let secret = ''
  const retry = async (reason: string, retryAfterSeconds?: number) => {
    const delay = retryAfterSeconds
      ? retryAfterSeconds * 1000
      : reconnectDelayMs(attempt)
    attempt += 1
    handlers.onStatus({
      state: 'reconnecting',
      inSeconds: Math.round(delay / 1000),
      reason,
    })
    await sleep(delay, signal)
  }

  handlers.onStatus({ state: 'connecting' })
  while (!signal.aborted) {
    const opened = await session.client.webhooks.listen({ signal })
    if (!opened.ok) {
      if (signal.aborted) return
      if (isFatal(opened.error)) {
        handlers.onFatal(fatalError(opened.error, session.url))
        return
      }
      await retry(
        opened.error.code === 'NETWORK_ERROR'
          ? 'sem conexão'
          : `HTTP ${opened.error.status}`,
        opened.error.retryAfterSeconds,
      )
      continue
    }
    for await (const message of opened.data) {
      if (message.type === 'ready') {
        attempt = 0
        secret = message.ready.secret
        handlers.onStatus({ state: 'listening', count: received })
      } else if (message.type === 'webhook') {
        const { frame, event } = message
        received += 1
        handlers.onEvent({
          id: frame.id,
          type: typeof event?.type === 'string' ? event.type : '?',
          at:
            typeof event?.createdAt === 'string'
              ? event.createdAt
              : new Date().toISOString(),
          verified: verifySignature(
            secret,
            frame.signature,
            frame.timestamp,
            frame.body,
            { toleranceSeconds: 0 },
          ),
          body: frame.body,
        })
        handlers.onStatus({ state: 'listening', count: received })
      } else {
        if (signal.aborted) return
        await retry(
          message.reason === 'idle' ? 'sem sinal do servidor' : 'rede',
        )
      }
    }
  }
}

function prettyBody(body: string): string {
  try {
    return formatJson(JSON.parse(body))
  } catch {
    return body
  }
}

export function WebhooksTab({
  active,
  session,
  height,
  width,
  onMode,
}: TabProps) {
  const [started, setStarted] = useState(false)
  const [run, setRun] = useState(0)
  const [events, setEvents] = useState<TailEvent[]>([])
  const [status, setStatus] = useState<ListenStatus>({ state: 'connecting' })
  const [fatal, setFatal] = useState<CliError | undefined>(undefined)
  const [selected, setSelected] = useState(0)
  const [open, setOpen] = useState<TailEvent | undefined>(undefined)
  const [filter, setFilter] = useState('')
  const [filtering, setFiltering] = useState(false)
  const follow = useRef(true)

  // Connects on first view and keeps tailing while other tabs are open.
  useEffect(() => {
    if (active) setStarted(true)
  }, [active])

  useEffect(() => {
    if (!started) return
    const controller = new AbortController()
    setFatal(undefined)
    tailWebhooks(session, controller.signal, {
      onEvent: (event) => {
        setEvents((list) => [event, ...list].slice(0, TAIL_LIMIT))
        // Keep the cursor on the same event unless it sits on the newest.
        if (!follow.current) setSelected((i) => i + 1)
      },
      onStatus: setStatus,
      onFatal: setFatal,
    })
    return () => controller.abort()
    // `run` restarts the connection on `r`.
  }, [started, session, run])

  const shown = filter
    ? events.filter((event) =>
        matchesFilter(`${event.type} ${event.id}`, filter),
      )
    : events
  const index = Math.max(0, Math.min(selected, shown.length - 1))
  follow.current = index === 0

  const mode: TabMode = filtering ? 'input' : open ? 'detail' : 'list'
  useEffect(() => {
    if (active) onMode(mode)
  }, [active, mode, onMode])

  const select = useCallback((next: number) => setSelected(next), [])

  useInput(
    (input, key) => {
      if (open) {
        if (key.escape) setOpen(undefined)
        return
      }
      if (key.upArrow || input === 'k') return select(Math.max(0, index - 1))
      if (key.downArrow || input === 'j') {
        return select(Math.min(shown.length - 1, index + 1))
      }
      if (input === '/') return setFiltering(true)
      if (input === 'r') {
        setEvents([])
        setSelected(0)
        return setRun((n) => n + 1)
      }
      if (key.return && shown[index]) setOpen(shown[index])
    },
    { isActive: active && !filtering },
  )

  if (!active) return null

  if (open) {
    return (
      <Box flexDirection='column'>
        <Text>
          <Text color={theme.muted}>
            {formatClock(open.at, session.timeZone)}
          </Text>{' '}
          <Text color={theme.brand} bold>
            {open.type}
          </Text>{' '}
          <Text color={theme.muted}>{open.id}</Text>
        </Text>
        {open.verified ? null : (
          <Text color={theme.warning}>
            {symbols.warning} Assinatura inválida para o segredo da escuta.
          </Text>
        )}
        <Box marginTop={1}>
          <Text>{prettyBody(open.body)}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted}>Esc volta</Text>
        </Box>
      </Box>
    )
  }

  if (fatal) return <ErrorState message={fatal.message} hint={fatal.hint} />

  return (
    <Box flexDirection='column'>
      <Box marginBottom={1}>
        <ListenStatusLine status={status} />
      </Box>
      {shown.length === 0 ? (
        <Empty>
          {filter
            ? `Nenhum evento com “${filter}”.`
            : 'Nenhum evento ainda. Em outro terminal, `steel trigger crm.lead.created` gera um de teste.'}
        </Empty>
      ) : (
        <RowList
          columns={[
            { key: 'at', label: 'Hora' },
            { key: 'type', label: 'Evento', flex: true },
            { key: 'id', label: 'Id' },
            { key: 'signature', label: 'Assinatura' },
          ]}
          rows={shown.map((event) => ({
            id: event.id,
            color: event.verified ? undefined : theme.warning,
            cells: {
              at: formatClock(event.at, session.timeZone),
              type: event.type,
              id: event.id,
              signature: event.verified ? 'ok' : 'inválida',
            },
          }))}
          selected={index}
          height={Math.max(3, height - 2 - (filtering || filter ? 3 : 0))}
          width={width}
        />
      )}
      {filtering ? (
        <Box marginTop={1}>
          <TextInput
            label='Filtrar:'
            initial={filter}
            placeholder='tipo ou id do evento'
            footer='Enter aplica · Esc limpa'
            onChange={setFilter}
            onSubmit={(value) => {
              setFilter(value.trim())
              setFiltering(false)
            }}
            onCancel={() => {
              setFilter('')
              setFiltering(false)
            }}
          />
        </Box>
      ) : filter ? (
        <Box marginTop={1}>
          <Text color={theme.muted}>
            Filtro: <Text color={theme.brandSoft}>{filter}</Text> · / muda
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}
