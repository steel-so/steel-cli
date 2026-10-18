/**
 * Steel palette (`--brand` and status colors of the app, as hex for the
 * terminal). Colors are switched off globally by `bin.ts` (FORCE_COLOR=0)
 * for NO_COLOR, `--no-color`, `--json` and non-TTY output.
 */
export const theme = {
  brand: '#3b82f6',
  brandSoft: '#60a5fa',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  muted: 'gray',
} as const

export const symbols = {
  success: '✔',
  error: '✖',
  warning: '⚠',
  info: '›',
  bullet: '•',
} as const

const MODULE_LABELS: Record<string, string> = {
  SERVICE_DESK: 'ServiceDesk',
  CRM: 'CRM',
  COMMUNICATION: 'Comunicação',
}

export function moduleLabel(module: string): string {
  return MODULE_LABELS[module] ?? module
}
