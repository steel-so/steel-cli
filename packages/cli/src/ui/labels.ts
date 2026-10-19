/**
 * pt-BR labels for the API enums, and the aliases accepted in flags
 * (`--type incidente`, `--status aguardando`). Unknown values fall back to
 * the raw enum, so a new server value never breaks a table.
 */

export const TICKET_TYPES = {
  INCIDENT: ['incidente', 'inc'],
  SERVICE_REQUEST: ['requisicao', 'requisição', 'req'],
  CHANGE: ['mudanca', 'mudança', 'mud'],
  PROBLEM: ['problema', 'prb'],
} as const satisfies Record<string, string[]>

export const TICKET_TYPE_LABELS: Record<string, string> = {
  INCIDENT: 'Incidente',
  SERVICE_REQUEST: 'Requisição',
  CHANGE: 'Mudança',
  PROBLEM: 'Problema',
}

export const PHASE_CATEGORIES = {
  NEW: ['novo', 'novos'],
  IN_PROGRESS: ['andamento', 'em-andamento'],
  WAITING: ['aguardando'],
  RESOLVED: ['resolvido', 'resolvidos'],
  CLOSED: ['fechado', 'fechados'],
  CANCELED: ['cancelado', 'cancelados'],
} as const satisfies Record<string, string[]>

export const PHASE_CATEGORY_LABELS: Record<string, string> = {
  NEW: 'Novo',
  IN_PROGRESS: 'Em andamento',
  WAITING: 'Aguardando',
  RESOLVED: 'Resolvido',
  CLOSED: 'Fechado',
  CANCELED: 'Cancelado',
}

export const LEAD_STAGES = {
  RECEIVED: ['recebido'],
  IN_CONTACT: ['em-contato', 'contato'],
  QUALIFIED: ['qualificado'],
  OPPORTUNITY: ['oportunidade'],
  PROPOSAL: ['proposta'],
  CLOSED: ['fechado'],
} as const satisfies Record<string, string[]>

export const LEAD_STAGE_LABELS: Record<string, string> = {
  RECEIVED: 'Recebido',
  IN_CONTACT: 'Em contato',
  QUALIFIED: 'Qualificado',
  OPPORTUNITY: 'Oportunidade',
  PROPOSAL: 'Proposta',
  CLOSED: 'Fechado',
}

export const TEMPLATE_STATUSES = {
  APPROVED: ['aprovado', 'aprovados'],
  PENDING: ['pendente', 'pendentes'],
  REJECTED: ['rejeitado', 'rejeitados'],
  PAUSED: ['pausado', 'pausados'],
  DISABLED: ['desativado', 'desativados'],
  ALL: ['todos'],
} as const satisfies Record<string, string[]>

export const TEMPLATE_STATUS_LABELS: Record<string, string> = {
  APPROVED: 'Aprovado',
  PENDING: 'Pendente',
  REJECTED: 'Rejeitado',
  PAUSED: 'Pausado',
  DISABLED: 'Desativado',
}

export const QUALITY_LABELS: Record<string, string> = {
  GREEN: 'Alta',
  YELLOW: 'Média',
  RED: 'Baixa',
  UNKNOWN: '—',
}

export const CONVERSATION_STATUS_LABELS: Record<string, string> = {
  NEW: 'Nova',
  IN_PROGRESS: 'Em atendimento',
  CLOSED: 'Encerrada',
}

export const BROADCAST_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  QUEUED: 'Na fila',
  RUNNING: 'Enviando',
  DONE: 'Concluída',
  FAILED: 'Falhou',
}

export const STAGE_CATEGORY_LABELS: Record<string, string> = {
  OPEN: 'Aberta',
  WON: 'Ganha',
  LOST: 'Perdida',
}

export const SLA_STATE_LABELS: Record<string, string> = {
  ok: 'no prazo',
  at_risk: 'em risco',
  breached: 'estourado',
  met: 'cumprido',
  paused: 'pausado',
  none: '—',
}

export const CATALOG_LEVEL_LABELS: Record<string, string> = {
  CATEGORY: 'Categoria',
  SUBCATEGORY: 'Subcategoria',
  SERVICE: 'Serviço',
}

export function label(map: Record<string, string>, value: string): string {
  return map[value] ?? value
}

export function formatDay(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeZone,
  }).format(new Date(iso))
}

export function formatMoney(amount: number | null): string {
  if (amount === null) return '—'
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(amount)
}

/** `120` → `2 h`, `-30` → `30 min atrás`. */
export function formatMinutes(minutes: number): string {
  const abs = Math.abs(Math.round(minutes))
  const text =
    abs >= 1440
      ? `${Math.floor(abs / 1440)} d`
      : abs >= 60
        ? `${Math.floor(abs / 60)} h`
        : `${abs} min`
  return minutes < 0 ? `${text} atrás` : text
}

/** A 20-cell text progress bar: `██████░░░░ 60%`. */
export function progressBar(done: number, total: number, width = 20): string {
  const ratio = total > 0 ? Math.min(done / total, 1) : 0
  const filled = Math.round(ratio * width)
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${Math.round(ratio * 100)}%`
}
