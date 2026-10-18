import type { SteelError } from '@steel-so/sdk'

/** Process exit codes. Part of the stable CLI contract (ADR 0034). */
export const EXIT = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  AUTH: 3,
  CANCELLED: 130,
} as const

export interface CliErrorOptions {
  hint?: string
  code?: string
  exitCode?: number
  cause?: unknown
}

/**
 * The only error type commands throw. `message` and `hint` are shown to the
 * user, so they are pt-BR; `code` is the stable identifier in `--json`.
 */
export class CliError extends Error {
  readonly hint?: string
  readonly code: string
  readonly exitCode: number

  constructor(message: string, options: CliErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = 'CliError'
    this.hint = options.hint
    this.code = options.code ?? 'CLI_ERROR'
    this.exitCode = options.exitCode ?? EXIT.ERROR
  }
}

export function usageError(message: string, hint?: string): CliError {
  return new CliError(message, { hint, code: 'USAGE', exitCode: EXIT.USAGE })
}

export function notLoggedIn(profile: string): CliError {
  return new CliError(`Você não está conectado no perfil “${profile}”.`, {
    hint: 'Rode `steel login` para entrar ou defina STEEL_TOKEN.',
    code: 'NOT_LOGGED_IN',
    exitCode: EXIT.AUTH,
  })
}

/** Translates an SDK error into what the user reads. */
export function fromSteelError(error: SteelError, url: string): CliError {
  const base = { code: error.code, cause: error }
  // A 401/403 with a specific code (API_TOKEN_SCOPE_REQUIRED, a module
  // that is off…) is still an auth failure: same message family, exit 3.
  const kind =
    error.status === 401
      ? 'UNAUTHORIZED'
      : error.status === 403
        ? 'FORBIDDEN'
        : error.code
  switch (kind) {
    case 'NETWORK_ERROR':
      return new CliError(`Não foi possível conectar a ${url}.`, {
        ...base,
        hint: 'Confira a sua conexão e a URL do perfil (`steel profile list`).',
      })
    case 'TIMEOUT':
      return new CliError(`O Steel em ${url} demorou demais para responder.`, {
        ...base,
        hint: 'Tente de novo em instantes.',
      })
    case 'UNAUTHORIZED':
      return new CliError('Token inválido, expirado ou revogado.', {
        ...base,
        hint: 'Rode `steel login` para entrar de novo.',
        exitCode: EXIT.AUTH,
      })
    case 'FORBIDDEN':
      return new CliError(
        error.message ?? 'O token não tem permissão para isso.',
        {
          ...base,
          hint: 'Confira o escopo (api:write para alterações) e os módulos do token com `steel whoami`.',
          exitCode: EXIT.AUTH,
        },
      )
    case 'RATE_LIMITED':
      return new CliError('Muitas requisições em pouco tempo.', {
        ...base,
        hint: error.retryAfterSeconds
          ? `Tente de novo em ${error.retryAfterSeconds} s.`
          : 'Aguarde um pouco e tente de novo.',
      })
    default:
      return new CliError(
        error.message ?? `O Steel respondeu ${error.status} (${error.code}).`,
        {
          ...base,
          hint: 'Se continuar, rode de novo com `--json` e envie a saída ao suporte.',
        },
      )
  }
}
