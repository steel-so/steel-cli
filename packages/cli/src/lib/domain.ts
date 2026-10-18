import { collectAll, type Page, type SteelResult } from '@steel-so/sdk'
import type { AuthTarget, Context } from '../context.js'
import { CliError, EXIT, fromSteelError, usageError } from '../errors.js'
import { cancelled } from './prompt.js'

export const MAX_PAGE_SIZE = 100

/** Flags shared by every list command. */
export interface PageOptions {
  limit?: string
  cursor?: string
  all?: boolean
}

export function unwrap<T>(result: SteelResult<T>, target: AuthTarget): T {
  if (!result.ok) throw fromSteelError(result.error, target.url)
  return result.data
}

export function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw usageError(
      `--limit inválido: ${value}`,
      `Use um número de 1 a ${MAX_PAGE_SIZE}; para trazer tudo, use --all.`,
    )
  }
  return limit
}

/**
 * One page (`--limit`, `--cursor`) or every page (`--all`, 100 per request
 * unless `--limit` says otherwise).
 */
export async function fetchPages<T>(
  target: AuthTarget,
  options: PageOptions,
  fetchPage: (query: {
    limit?: number
    cursor?: string
  }) => Promise<SteelResult<Page<T>>>,
): Promise<Page<T>> {
  const limit = parseLimit(options.limit)
  if (options.all && options.cursor) {
    throw usageError('Use --all ou --cursor, não os dois.')
  }
  const result = options.all
    ? await collectAll<T>((cursor) =>
        fetchPage({ limit: limit ?? MAX_PAGE_SIZE, cursor }),
      )
    : await fetchPage({ limit, cursor: options.cursor })
  return unwrap(result, target)
}

/** Every page, for lookups (templates, pipelines, catalog). */
export function fetchAll<T>(
  target: AuthTarget,
  fetchPage: (query: {
    limit?: number
    cursor?: string
  }) => Promise<SteelResult<Page<T>>>,
): Promise<Page<T>> {
  return fetchPages(target, { all: true }, fetchPage)
}

/**
 * A required value: the flag, else a question on a terminal, else a usage
 * error naming the flag (never prompts outside a TTY).
 */
export async function required<T>(
  ctx: Context,
  value: T | undefined,
  flag: string,
  ask: () => Promise<T>,
  hint?: string,
): Promise<T> {
  if (value !== undefined && value !== '') return value
  if (ctx.interactive) return ask()
  throw usageError(`Falta ${flag}.`, hint ?? 'Veja as opções com `--help`.')
}

/** Asks before a write on a terminal; `--yes` and scripts skip it. */
export async function confirmWrite(
  ctx: Context,
  yes: boolean | undefined,
  message: string,
): Promise<void> {
  if (yes || !ctx.interactive) return
  const confirmed = await ctx.prompt.confirm(message)
  if (!confirmed) throw cancelled()
}

/** `texto`, `@arquivo` or `@-` (stdin). */
export async function readTextArg(ctx: Context, value: string) {
  if (value === '@-') return ctx.io.readStdin()
  if (!value.startsWith('@')) return value
  const file = value.slice(1)
  try {
    return await ctx.deps.readFile(file)
  } catch (cause) {
    throw new CliError(`Não foi possível ler ${file}.`, {
      code: 'USAGE',
      exitCode: EXIT.USAGE,
      cause,
    })
  }
}

/** Repeatable flag collector for commander. */
export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value]
}

/** `a,b` and repeated flags → one list. */
export function splitList(values: string[] | undefined): string[] | undefined {
  const items = (values ?? [])
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)
  return items.length > 0 ? items : undefined
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}

/**
 * Maps flag values to API enum values: the enum itself (any case) or a
 * pt-BR alias, accents and separators ignored.
 */
export function parseEnum<T extends string>(
  values: string[] | undefined,
  aliases: Record<T, string[]>,
  flag: string,
): T[] | undefined {
  const items = splitList(values)
  if (!items) return undefined
  const lookup = new Map<string, T>()
  for (const [value, names] of Object.entries(aliases) as Array<
    [T, string[]]
  >) {
    lookup.set(fold(value), value)
    for (const name of names) lookup.set(fold(name), value)
  }
  return items.map((item) => {
    const value = lookup.get(fold(item))
    if (!value) {
      throw usageError(
        `Valor inválido para ${flag}: ${item}`,
        `Use ${Object.keys(aliases).join(', ').toLowerCase()}.`,
      )
    }
    return value
  })
}

export function sameText(a: string, b: string): boolean {
  return fold(a) === fold(b)
}

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
