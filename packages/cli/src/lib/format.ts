const DAY_MS = 86_400_000

export function formatDate(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(iso))
}

/** Whole days from `now` until `iso` (negative when in the past). */
export function daysUntil(iso: string, now: number = Date.now()): number {
  return Math.floor((new Date(iso).getTime() - now) / DAY_MS)
}

export function relativeDays(days: number): string {
  if (days < 0) return 'expirado'
  if (days === 0) return 'expira hoje'
  if (days === 1) return 'em 1 dia'
  return `em ${days} dias`
}
