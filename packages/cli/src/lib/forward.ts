import { WEBHOOK_HEADERS, type WebhookListenFrame } from '@steel-so/sdk'
import { usageError } from '../errors.js'
import { VERSION } from '../version.js'

/** Same budget Steel gives a real delivery. */
export const FORWARD_TIMEOUT_MS = 10_000

export type ForwardResult =
  | { ok: boolean; status: number; durationMs: number }
  | {
      ok: false
      error: 'timeout' | 'network'
      message: string
      durationMs: number
    }

/**
 * `--forward` accepts what people type: `3001`, `localhost:3001/hooks`,
 * `http://127.0.0.1:3001/hooks` or any http(s) URL.
 */
export function normalizeForwardUrl(input: string): string {
  const raw = input.trim()
  let candidate = raw
  if (/^\d{1,5}$/.test(raw)) candidate = `http://localhost:${raw}/`
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) candidate = `http://${raw}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw usageError(
      `URL de encaminhamento inválida: ${input}`,
      'Exemplo: --forward localhost:3001/api/webhooks/steel',
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw usageError(
      `A URL de encaminhamento precisa ser http:// ou https://: ${input}`,
    )
  }
  return url.toString()
}

/**
 * POSTs the exact event body to the local app with the same three
 * `Steel-Webhook-*` headers Steel sends, so the app's signature check runs
 * unchanged. Never throws.
 */
export async function forwardFrame(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  frame: WebhookListenFrame,
  options: { timeoutMs?: number; now?: () => number } = {},
): Promise<ForwardResult> {
  const now = options.now ?? Date.now
  const started = now()
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? FORWARD_TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'user-agent': `Steel-Webhooks/1.0 (steel-cli/${VERSION})`,
        [WEBHOOK_HEADERS.id]: frame.id,
        [WEBHOOK_HEADERS.timestamp]: String(frame.timestamp),
        [WEBHOOK_HEADERS.signature]: frame.signature,
      },
      body: frame.body,
    })
    // Drain the answer so the socket is reused; its content is not shown.
    await response.arrayBuffer().catch(() => undefined)
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      durationMs: Math.max(0, now() - started),
    }
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : ''
    const timeout = name === 'TimeoutError' || name === 'AbortError'
    return {
      ok: false,
      error: timeout ? 'timeout' : 'network',
      message: cause instanceof Error ? cause.message : String(cause),
      durationMs: Math.max(0, now() - started),
    }
  }
}
