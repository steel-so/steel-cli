import type { Context } from '../context.js'
import { CliError, EXIT, fromSteelError, usageError } from '../errors.js'
import { ErrorMessage } from '../ui/components.js'
import { formatJson } from '../ui/json.js'

export const API_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export const API_PREFIX = '/api/v1'

export interface ApiOptions {
  data?: string
  query?: string[]
}

/**
 * `/me`, `me` and `/api/v1/me` all mean `/api/v1/me`: the CLI only talks
 * to the public API v1 (ADR 0034). A `?query` in the path is kept.
 */
function append(map: Record<string, string[]>, key: string, value: string) {
  const list = map[key] ?? []
  list.push(value)
  map[key] = list
}

export function resolveApiPath(input: string): {
  path: string
  query: Record<string, string[]>
} {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    throw usageError(
      'Informe só o caminho, não a URL completa.',
      'Exemplo: `steel api GET /me`. A URL vem do perfil.',
    )
  }
  const [rawPath = '', rawQuery] = input.split('?', 2)
  let path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`
  if (path === API_PREFIX || path.startsWith(`${API_PREFIX}/`)) {
    path = path.slice(API_PREFIX.length) || '/'
  }
  if (path.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw usageError('O caminho não pode ter “.” nem “..”.')
  }
  const query: Record<string, string[]> = {}
  for (const [key, value] of new URLSearchParams(rawQuery ?? '')) {
    append(query, key, value)
  }
  return { path: `${API_PREFIX}${path === '/' ? '' : path}`, query }
}

export function parseQuery(
  pairs: string[] = [],
  into: Record<string, string[]> = {},
): Record<string, string[]> {
  for (const pair of pairs) {
    const index = pair.indexOf('=')
    if (index <= 0) {
      throw usageError(
        `Parâmetro inválido: ${pair}`,
        'Use -q chave=valor (repita para mais de um).',
      )
    }
    append(into, pair.slice(0, index), pair.slice(index + 1))
  }
  return into
}

async function readData(ctx: Context, data: string): Promise<unknown> {
  let text = data
  if (data === '@-') text = await ctx.io.readStdin()
  else if (data.startsWith('@')) {
    const file = data.slice(1)
    try {
      text = await ctx.deps.readFile(file)
    } catch (cause) {
      throw new CliError(`Não foi possível ler ${file}.`, {
        code: 'USAGE',
        exitCode: EXIT.USAGE,
        cause,
      })
    }
  }
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new CliError('O corpo não é um JSON válido.', {
      hint: `${(cause as Error).message}. Use -d '{"campo":"valor"}', -d @arquivo.json ou -d @- (stdin).`,
      code: 'USAGE',
      exitCode: EXIT.USAGE,
      cause,
    })
  }
}

export async function api(
  ctx: Context,
  methodInput: string,
  pathInput: string,
  options: ApiOptions,
): Promise<number> {
  const method = methodInput.toUpperCase()
  if (!(API_METHODS as readonly string[]).includes(method)) {
    throw usageError(
      `Método HTTP inválido: ${methodInput}`,
      `Use ${API_METHODS.join(', ')}.`,
    )
  }
  const { path, query } = resolveApiPath(pathInput)
  parseQuery(options.query, query)
  if (options.data !== undefined && (method === 'GET' || method === 'DELETE')) {
    throw usageError(`${method} não aceita corpo (-d).`)
  }
  const body =
    options.data === undefined ? undefined : await readData(ctx, options.data)

  const target = await ctx.authTarget()
  const result = await ctx
    .client(target, target.token)
    .request({ method, path, query, body })
  if (!result.ok) throw fromSteelError(result.error, target.url)

  const response = result.data
  if (typeof response.body === 'string') {
    ctx.io.stdout.write(
      response.body.endsWith('\n') ? response.body : `${response.body}\n`,
    )
  } else if (response.body !== null) {
    ctx.io.stdout.write(
      `${ctx.json ? JSON.stringify(response.body, null, 2) : formatJson(response.body)}\n`,
    )
  }

  if (response.ok) return EXIT.OK
  if (!ctx.json && ctx.io.stderr.isTTY) {
    const code =
      typeof response.body === 'object' && response.body !== null
        ? (response.body as { error?: { code?: string } }).error?.code
        : undefined
    ctx.render(
      <ErrorMessage
        message={`${method} ${path} respondeu ${response.status}${code ? ` (${code})` : ''}.`}
      />,
      ctx.io.stderr,
    )
  }
  return response.status === 401 || response.status === 403
    ? EXIT.AUTH
    : EXIT.ERROR
}
