import { Box, Static, Text } from 'ink'
import Spinner from 'ink-spinner'
import type { ForwardResult } from '../lib/forward.js'
import { Code, Hint, KeyValue, Success, Warning } from './components.js'
import { formatJson } from './json.js'
import { symbols, theme } from './theme.js'

export interface ListenHeaderItem {
  kind: 'header'
  workspace: string
  profileName: string
  url: string
  events: string[]
  forwardUrl?: string
  secret: string
}

export interface ListenEventItem {
  kind: 'event'
  id: string
  type: string
  /** ISO time of the event (its `createdAt`, or when it arrived). */
  at: string
  verified: boolean
  forward?: ForwardResult
  /** Raw body, shown pretty-printed with `--print`. */
  body?: string
}

export interface ListenNoticeItem {
  kind: 'notice'
  tone: 'success' | 'warning'
  text: string
}

export type ListenItem = ListenHeaderItem | ListenEventItem | ListenNoticeItem

export type ListenStatus =
  | { state: 'connecting' }
  | { state: 'listening'; count: number }
  | { state: 'reconnecting'; inSeconds: number; reason: string }

export function formatClock(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(iso))
}

function ListenHeader({ item }: { item: ListenHeaderItem }) {
  return (
    <Box flexDirection='column' marginBottom={1}>
      <Success>
        Escutando eventos de <Text bold>{item.workspace}</Text>{' '}
        <Text color={theme.muted}>
          ({item.profileName} · {item.url})
        </Text>
      </Success>
      <Box paddingLeft={2}>
        <KeyValue
          rows={[
            ['Eventos', item.events.length ? item.events.join(', ') : 'todos'],
            [
              'Encaminha',
              item.forwardUrl ? (
                <Text key='f' color={theme.brandSoft}>
                  POST {item.forwardUrl}
                </Text>
              ) : (
                <Text key='f' color={theme.muted}>
                  não (use --forward)
                </Text>
              ),
            ],
            ['Segredo', <Code key='s'>{item.secret}</Code>],
          ]}
        />
      </Box>
      <Hint>
        Verifique as assinaturas com este segredo (verifySignature do
        @steel-so/sdk). Ctrl+C encerra.
      </Hint>
    </Box>
  )
}

function ForwardOutcome({ forward }: { forward: ForwardResult }) {
  if ('error' in forward) {
    return (
      <Text color={theme.danger}>
        {symbols.error}{' '}
        {forward.error === 'timeout'
          ? 'sem resposta em 10 s'
          : `falhou: ${forward.message}`}
      </Text>
    )
  }
  return (
    <Text>
      <Text color={forward.ok ? theme.success : theme.danger}>
        {forward.status}
      </Text>{' '}
      <Text color={theme.muted}>({forward.durationMs} ms)</Text>
    </Text>
  )
}

export function ListenEventLine({
  item,
  timeZone,
}: {
  item: ListenEventItem
  timeZone?: string
}) {
  return (
    <Box flexDirection='column'>
      <Text>
        <Text color={theme.muted}>{formatClock(item.at, timeZone)}</Text>{' '}
        <Text color={theme.brand} bold>
          {item.type}
        </Text>{' '}
        <Text color={theme.muted}>{item.id}</Text>
        {item.forward ? (
          <>
            <Text color={theme.muted}> → </Text>
            <ForwardOutcome forward={item.forward} />
          </>
        ) : null}
        {item.verified ? null : (
          <Text color={theme.warning}>
            {' '}
            {symbols.warning} assinatura inválida
          </Text>
        )}
      </Text>
      {item.body !== undefined ? (
        <Box paddingLeft={2} marginBottom={1}>
          <Text>{prettyBody(item.body)}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

function prettyBody(body: string): string {
  try {
    return formatJson(JSON.parse(body))
  } catch {
    return body
  }
}

export function ListenItemView({
  item,
  timeZone,
}: {
  item: ListenItem
  timeZone?: string
}) {
  if (item.kind === 'header') return <ListenHeader item={item} />
  if (item.kind === 'event') {
    return <ListenEventLine item={item} timeZone={timeZone} />
  }
  return item.tone === 'success' ? (
    <Success>{item.text}</Success>
  ) : (
    <Warning>{item.text}</Warning>
  )
}

export function ListenStatusLine({ status }: { status: ListenStatus }) {
  const spinner = (
    <Text color={theme.brand}>
      <Spinner type='dots' />
    </Text>
  )
  if (status.state === 'connecting') {
    return <Text>{spinner} Conectando ao Steel…</Text>
  }
  if (status.state === 'reconnecting') {
    return (
      <Text>
        {spinner} Conexão perdida ({status.reason}). Reconectando em{' '}
        {status.inSeconds} s…
      </Text>
    )
  }
  return (
    <Text>
      {spinner} Aguardando eventos…{' '}
      <Text color={theme.muted}>
        {status.count === 1 ? '1 recebido' : `${status.count} recebidos`} ·
        Ctrl+C encerra
      </Text>
    </Text>
  )
}

/** Live `steel listen`: an append-only log plus a status line. */
export function ListenApp({
  items,
  status,
  timeZone,
}: {
  items: ListenItem[]
  status: ListenStatus
  timeZone?: string
}) {
  return (
    <>
      <Static items={items}>
        {(item, index) => (
          <ListenItemView key={index} item={item} timeZone={timeZone} />
        )}
      </Static>
      <ListenStatusLine status={status} />
    </>
  )
}
