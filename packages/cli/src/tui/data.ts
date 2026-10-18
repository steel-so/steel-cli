import {
  type CrmOpportunity,
  type CrmPipeline,
  type CrmPipelineStage,
  collectAll,
  type Me,
  type ModuleKind,
  type SdPhaseSummary,
  type SdTicket,
  type SteelClient,
  type SteelResult,
  type WhatsAppTemplate,
} from '@steel-so/sdk'
import { CliError, fromSteelError } from '../errors.js'
import { MAX_PAGE_SIZE } from '../lib/domain.js'

/** The SDK surface the dashboard uses; tests pass a mock of it. */
export type DashboardClient = Pick<
  SteelClient,
  'servicedesk' | 'crm' | 'whatsapp' | 'webhooks'
>

export interface DashboardSession {
  client: DashboardClient
  me: Me
  profileName: string
  url: string
  timeZone?: string
  /** Waits between listen reconnections; aborts early on `signal`. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

/** Turns an SDK failure into the pt-BR error the dashboard shows. */
export function check<T>(result: SteelResult<T>, url: string): T {
  if (!result.ok) throw fromSteelError(result.error, url)
  return result.data
}

export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) return error
  return new CliError('Erro inesperado no painel.', {
    hint: error instanceof Error ? error.message : String(error),
    code: 'INTERNAL',
  })
}

export function moduleDisabled(name: string): CliError {
  return new CliError(`O token não tem acesso ao módulo ${name}.`, {
    hint: 'Rode `steel login` e marque o módulo, ou peça acesso ao admin do workspace.',
    code: 'MODULE_DISABLED',
  })
}

export function hasModule(me: Me, module: ModuleKind): boolean {
  return me.modules.includes(module)
}

/* ------------------------------------------------------------------ */
/* ServiceDesk: my queue ordered by SLA risk                           */
/* ------------------------------------------------------------------ */

/** Open phase categories: what still needs work. */
export const QUEUE_STATUSES = ['NEW', 'IN_PROGRESS', 'WAITING'] as const

const SLA_RANK: Record<string, number> = {
  breached: 0,
  at_risk: 1,
  ok: 2,
  paused: 3,
  none: 4,
  met: 5,
}

function rank(ticket: SdTicket): number {
  const { firstResponse, resolution } = ticket.sla
  return Math.min(
    SLA_RANK[firstResponse.state] ?? 4,
    SLA_RANK[resolution.state] ?? 4,
  )
}

function remaining(ticket: SdTicket): number {
  const values = [
    ticket.sla.firstResponse.remainingMinutes,
    ticket.sla.resolution.remainingMinutes,
  ].filter((value): value is number => value !== null)
  return values.length > 0 ? Math.min(...values) : Number.POSITIVE_INFINITY
}

/** Breached first, then at risk, then by the clock closest to its deadline. */
export function sortBySlaRisk(tickets: SdTicket[]): SdTicket[] {
  return [...tickets].sort(
    (a, b) =>
      rank(a) - rank(b) || remaining(a) - remaining(b) || a.number - b.number,
  )
}

export interface QueueData {
  tickets: SdTicket[]
  breached: number
  atRisk: number
}

export function summarizeQueue(tickets: SdTicket[]): QueueData {
  const sorted = sortBySlaRisk(tickets)
  return {
    tickets: sorted,
    breached: sorted.filter((ticket) => rank(ticket) === 0).length,
    atRisk: sorted.filter((ticket) => rank(ticket) === 1).length,
  }
}

export async function loadQueue(session: DashboardSession): Promise<QueueData> {
  if (!hasModule(session.me, 'SERVICE_DESK')) {
    throw moduleDisabled('ServiceDesk')
  }
  const sd = session.client.servicedesk
  const page = check(
    await collectAll<SdTicket>((cursor) =>
      sd.tickets.list({
        assigneeId: ['me'],
        status: [...QUEUE_STATUSES],
        limit: MAX_PAGE_SIZE,
        cursor,
      }),
    ),
    session.url,
  )
  return summarizeQueue(page.items)
}

/**
 * Phases a ticket can move to. The API v1 has no phase list, so these are
 * the phases seen in the queue (same workflow), current one excluded.
 */
export function knownPhases(
  tickets: SdTicket[],
  current?: string,
): SdPhaseSummary[] {
  const phases = new Map<string, SdPhaseSummary>()
  for (const ticket of tickets) phases.set(ticket.phase.id, ticket.phase)
  return [...phases.values()]
    .filter((phase) => phase.id !== current)
    .sort((a, b) => a.position - b.position)
}

/* ------------------------------------------------------------------ */
/* CRM: opportunities grouped by stage                                 */
/* ------------------------------------------------------------------ */

export interface StageGroup {
  stage: CrmPipelineStage
  opportunities: CrmOpportunity[]
  total: number
}

export interface PipelineBoard {
  pipeline: CrmPipeline
  groups: StageGroup[]
}

export interface CrmData {
  boards: PipelineBoard[]
}

/** One board per pipeline (default first), stages in their order. */
export function groupByStage(
  pipelines: CrmPipeline[],
  opportunities: CrmOpportunity[],
): PipelineBoard[] {
  return [...pipelines]
    .sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) || a.position - b.position,
    )
    .map((pipeline) => ({
      pipeline,
      groups: [...pipeline.stages]
        .sort((a, b) => a.position - b.position)
        .map((stage) => {
          const items = opportunities.filter(
            (opportunity) => opportunity.stageId === stage.id,
          )
          return {
            stage,
            opportunities: items,
            total: items.reduce((sum, item) => sum + (item.amount ?? 0), 0),
          }
        }),
    }))
}

export async function loadCrm(session: DashboardSession): Promise<CrmData> {
  if (!hasModule(session.me, 'CRM')) throw moduleDisabled('CRM')
  const crm = session.client.crm
  const [pipelines, opportunities] = await Promise.all([
    collectAll<CrmPipeline>((cursor) =>
      crm.pipelines({ limit: MAX_PAGE_SIZE, cursor }),
    ),
    collectAll<CrmOpportunity>((cursor) =>
      crm.opportunities.list({ limit: MAX_PAGE_SIZE, cursor }),
    ),
  ])
  return {
    boards: groupByStage(
      check(pipelines, session.url).items,
      check(opportunities, session.url).items,
    ),
  }
}

/* ------------------------------------------------------------------ */
/* Comunicação                                                         */
/* ------------------------------------------------------------------ */

export interface ZapData {
  templates: WhatsAppTemplate[]
}

export async function loadZap(session: DashboardSession): Promise<ZapData> {
  if (!hasModule(session.me, 'COMMUNICATION')) {
    throw moduleDisabled('Comunicação')
  }
  const result = await collectAll<WhatsAppTemplate>((cursor) =>
    session.client.whatsapp.templates({
      status: 'APPROVED',
      limit: MAX_PAGE_SIZE,
      cursor,
    }),
  )
  return { templates: check(result, session.url).items }
}

/** Body text of a template, for the detail view. */
export function templateBody(template: WhatsAppTemplate): string {
  const parts = (template.components as Array<{ type?: string; text?: string }>)
    .filter((part) => typeof part?.text === 'string')
    .map((part) => part.text as string)
  return parts.join('\n\n')
}

/* ------------------------------------------------------------------ */

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/** `/` filter: every word of the query appears in the text. */
export function matchesFilter(text: string, query: string): boolean {
  const haystack = fold(text)
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}
