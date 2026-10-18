import type { SdTicket } from '@steel-so/sdk'
import { Box, Text, useInput } from 'ink'
import { useEffect } from 'react'
import { slaColor, slaText } from '../commands/sd.js'
import { truncate } from '../lib/domain.js'
import { formatDate } from '../lib/format.js'
import { KeyValue } from '../ui/components.js'
import { label, TICKET_TYPE_LABELS } from '../ui/labels.js'
import { theme } from '../ui/theme.js'
import { check, knownPhases, loadQueue, type QueueData } from './data.js'
import { capturesKeys, FlowView, useFlow } from './flow.js'
import {
  type DetailProps,
  ListTab,
  type ListTabConfig,
  type TabProps,
} from './list-tab.js'

type Clock = SdTicket['sla']['resolution']

/** The clock that matters now: first response until it is met. */
function activeClock(ticket: SdTicket): Clock {
  const { firstResponse, resolution } = ticket.sla
  return firstResponse.state === 'breached' ||
    firstResponse.state === 'at_risk' ||
    firstResponse.state === 'ok'
    ? firstResponse
    : resolution
}

const OTHER_PHASE = '__other__'
/** Title, blank, nine fields, two margins and the key line. */
const DETAIL_FIXED_ROWS = 14

function TicketDetail({
  item: ticket,
  data,
  session,
  active,
  width,
  height,
  onBack,
  onChanged,
  onMode,
}: DetailProps<QueueData, SdTicket>) {
  const flow = useFlow(onChanged)
  const { step, setStep, cancel, confirmThenRun } = flow
  const sd = session.client.servicedesk
  const busy = capturesKeys(step)

  useEffect(() => {
    onMode(busy ? 'input' : 'detail')
  }, [busy, onMode])

  const comment = (internal: boolean) => {
    setStep({
      kind: 'text',
      label: internal ? 'Comentário interno:' : 'Comentário público:',
      placeholder: 'escreva e tecle Enter',
      footer: `Tab: ${internal ? 'público' : 'interno'} · Enter confirma · Esc cancela`,
      extra: (_input, key) => {
        if (!key.tab) return false
        comment(!internal)
        return true
      },
      onSubmit: (value) => {
        const body = value.trim()
        if (!body) return cancel()
        confirmThenRun(
          `Publicar comentário ${internal ? 'interno' : 'público (o solicitante vê)'} no chamado ${ticket.code}?`,
          'Publicando…',
          async () => {
            check(
              await sd.tickets.comment(ticket.id, {
                body,
                visibility: internal ? 'INTERNAL' : 'PUBLIC',
              }),
              session.url,
            )
            return `Comentário ${internal ? 'interno' : 'público'} publicado no chamado ${ticket.code}.`
          },
        )
      },
    })
  }

  const moveTo = (phaseId: string, name: string) =>
    confirmThenRun(
      `Mover o chamado ${ticket.code} para a fase ${name}?`,
      'Movendo…',
      async () => {
        const moved = check(
          await sd.tickets.move(ticket.id, { phaseId }),
          session.url,
        )
        return `${moved.code} agora está em ${moved.phase.name} (${moved.completionPercent}%).`
      },
    )

  const askPhaseId = () =>
    setStep({
      kind: 'text',
      label: 'Id da fase de destino:',
      onSubmit: (value) =>
        value.trim() ? moveTo(value.trim(), value.trim()) : cancel(),
    })

  const move = () => {
    const phases = knownPhases(data.tickets, ticket.phaseId)
    if (phases.length === 0) return askPhaseId()
    setStep({
      kind: 'select',
      label: `Mover ${ticket.code} para`,
      choices: [
        ...phases.map((phase) => ({
          value: phase.id,
          label: phase.name,
          hint: `${phase.completionPercent}%`,
        })),
        { value: OTHER_PHASE, label: 'Outra fase (pelo id)…' },
      ],
      onSubmit: (value) => {
        if (value === OTHER_PHASE) return askPhaseId()
        const phase = phases.find((item) => item.id === value)
        moveTo(value, phase?.name ?? value)
      },
    })
  }

  useInput(
    (input, key) => {
      if (key.escape) return onBack()
      if (input === 'c') return comment(false)
      if (input === 'm') return move()
    },
    { isActive: active && !busy },
  )

  const catalog = [ticket.category, ticket.subcategory, ticket.service]
    .filter((item) => item !== null)
    .map((item) => item.name)
    .join(' › ')
  const date = (iso: string | null) =>
    iso ? formatDate(iso, session.timeZone) : '—'
  const title = (
    <Text>
      <Text color={theme.brand} bold>
        {ticket.code}
      </Text>{' '}
      <Text bold>{ticket.title}</Text>
    </Text>
  )
  // While asking something, the prompt matters more than the fields.
  if (step.kind !== 'idle') {
    return (
      <Box flexDirection='column'>
        {title}
        <Text color={theme.muted}>
          {ticket.phase.name} · {ticket.completionPercent}% · SLA{' '}
          {slaText(ticket.sla.resolution)}
        </Text>
        <Box marginTop={1} flexDirection='column'>
          <FlowView step={step} onCancel={cancel} />
          {busy ? null : (
            <Text color={theme.muted}>
              c comenta · m move de fase · Esc volta
            </Text>
          )}
        </Box>
      </Box>
    )
  }
  const descriptionLines = height - DETAIL_FIXED_ROWS
  const description = ticket.description?.trim()
  return (
    <Box flexDirection='column'>
      {title}
      <Text> </Text>
      <KeyValue
        rows={[
          ['Tipo', label(TICKET_TYPE_LABELS, ticket.type)],
          ['Fase', `${ticket.phase.name} · ${ticket.completionPercent}%`],
          ['Prioridade', ticket.priority?.name ?? '—'],
          ['Catálogo', catalog || '—'],
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
          ['Aberto em', date(ticket.createdAt)],
          ['Atualizado', date(ticket.lastActivityAt)],
        ]}
      />
      {description && descriptionLines > 0 ? (
        <Box marginTop={1}>
          <Text>{truncate(description, descriptionLines * width)}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={theme.muted}>c comenta · m move de fase · Esc volta</Text>
      </Box>
    </Box>
  )
}

export const servicedeskConfig: ListTabConfig<QueueData, SdTicket> = {
  loadingLabel: 'Carregando a sua fila…',
  load: loadQueue,
  items: (data) => data.tickets,
  id: (ticket) => ticket.id,
  columns: [
    { key: 'code', label: 'Código' },
    { key: 'title', label: 'Título', flex: true },
    { key: 'phase', label: 'Fase' },
    { key: 'priority', label: 'Prioridade' },
    { key: 'sla', label: 'SLA' },
  ],
  row: (ticket) => {
    const clock = activeClock(ticket)
    return {
      id: ticket.id,
      color: slaColor(clock) === theme.success ? undefined : slaColor(clock),
      cells: {
        code: ticket.code,
        title: ticket.title,
        phase: ticket.phase.name,
        priority: ticket.priority?.name ?? '—',
        sla: slaText(clock),
      },
    }
  },
  text: (ticket) =>
    [
      ticket.code,
      String(ticket.number),
      ticket.title,
      ticket.phase.name,
      ticket.priority?.name ?? '',
      ticket.requester?.name ?? '',
    ].join(' '),
  empty: 'Nenhum chamado aberto com você. Fila limpa!',
  summary: (data) => (
    <Text>
      <Text bold>Minha fila</Text>{' '}
      <Text color={theme.muted}>
        {data.tickets.length === 1
          ? '1 chamado'
          : `${data.tickets.length} chamados`}
      </Text>
      {data.breached > 0 ? (
        <Text color={theme.danger}> · {data.breached} estourado(s)</Text>
      ) : null}
      {data.atRisk > 0 ? (
        <Text color={theme.warning}> · {data.atRisk} em risco</Text>
      ) : null}
    </Text>
  ),
  Detail: TicketDetail,
}

export function ServicedeskTab(props: TabProps) {
  return <ListTab {...props} config={servicedeskConfig} />
}
