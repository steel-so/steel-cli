/**
 * The SDK never throws for HTTP or network failures: every call resolves to
 * a `SteelResult`, mirroring the `Result` type the Steel app uses (ADR 0002).
 */
export interface SteelError {
  /** HTTP status, or 0 when the request never got a response. */
  status: number
  /** `ERROR_CODES` key from the Steel envelope, or `NETWORK_ERROR`/`TIMEOUT`. */
  code: string
  message?: string
  details?: unknown
  /** Parsed from `Retry-After` when the server sends it. */
  retryAfterSeconds?: number
}

export type SteelResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; error: SteelError }

const FALLBACK_CODES: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  410: 'EXPIRED_TOKEN',
  428: 'AUTHORIZATION_PENDING',
  429: 'RATE_LIMITED',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Builds a `SteelError` from a non-2xx response and its (parsed) body. */
export function errorFromResponse(
  response: Pick<Response, 'status' | 'headers'>,
  body: unknown,
): SteelError {
  const error: SteelError = {
    status: response.status,
    code: FALLBACK_CODES[response.status] ?? 'HTTP_ERROR',
  }
  if (isRecord(body)) {
    const envelopeError = body.error
    if (isRecord(envelopeError) && typeof envelopeError.code === 'string') {
      error.code = envelopeError.code
      if (envelopeError.details !== undefined) {
        error.details = envelopeError.details
      }
    }
    if (typeof body.message === 'string') error.message = body.message
  }
  const retryAfter = Number(response.headers.get('retry-after'))
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    error.retryAfterSeconds = retryAfter
  }
  return error
}

/** Maps a thrown `fetch` error (DNS, refused, abort, timeout) to a result. */
export function toNetworkError(cause: unknown): SteelError {
  const name = isRecord(cause) ? cause.name : undefined
  const message = cause instanceof Error ? cause.message : String(cause)
  if (name === 'TimeoutError') {
    return { status: 0, code: 'TIMEOUT', message }
  }
  if (name === 'AbortError') {
    return { status: 0, code: 'ABORTED', message }
  }
  return { status: 0, code: 'NETWORK_ERROR', message }
}
