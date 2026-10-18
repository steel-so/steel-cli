import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Signature of Steel's outbound webhooks (ADR 0036):
 *
 *   Steel-Signature: v1=<hex HMAC-SHA256 of "<timestamp>.<body>">
 *
 * keyed by the endpoint secret (`whsec_...`, used as UTF-8 text), where
 * `timestamp` is the `Steel-Webhook-Timestamp` header (Unix seconds) and
 * `body` is the raw request body, byte for byte, before any JSON parsing.
 */

export const WEBHOOK_HEADERS = {
  id: 'Steel-Webhook-Id',
  timestamp: 'Steel-Webhook-Timestamp',
  signature: 'Steel-Signature',
} as const

export const SIGNATURE_VERSION = 'v1'

/** Default tolerance between the timestamp and the receiver's clock. */
export const DEFAULT_TOLERANCE_SECONDS = 5 * 60

export interface VerifySignatureOptions {
  /** Maximum clock difference accepted. `0` disables the check. */
  toleranceSeconds?: number
  /** Receiver clock (Unix seconds); defaults to now. */
  nowSeconds?: number
}

/** `v1=<hex>` for a body, as Steel computes it. */
export function signPayload(
  secret: string,
  timestamp: number | string,
  body: string,
): string {
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`, 'utf8')
    .digest('hex')
  return `${SIGNATURE_VERSION}=${digest}`
}

/**
 * Checks a delivery from Steel. Returns `true` only when the timestamp is an
 * integer within the tolerance and one of the `v1=` entries of the
 * `Steel-Signature` header (comma-separated during a secret rotation)
 * matches. The comparison is constant-time; it never throws.
 *
 * ```ts
 * const ok = verifySignature(
 *   process.env.STEEL_WEBHOOK_SECRET,
 *   req.headers['steel-signature'],
 *   req.headers['steel-webhook-timestamp'],
 *   rawBody,
 * )
 * ```
 */
export function verifySignature(
  secret: string,
  header: string | null | undefined,
  timestamp: string | number | null | undefined,
  body: string,
  options: VerifySignatureOptions = {},
): boolean {
  if (!secret || !header || timestamp === null || timestamp === undefined) {
    return false
  }
  const raw = String(timestamp).trim()
  if (!/^\d+$/.test(raw)) return false
  const seconds = Number(raw)

  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS
  if (tolerance > 0) {
    const now = options.nowSeconds ?? Math.floor(Date.now() / 1000)
    if (Math.abs(now - seconds) > tolerance) return false
  }

  const expected = Buffer.from(signPayload(secret, raw, body), 'utf8')
  let matched = false
  for (const part of header.split(',')) {
    const candidate = Buffer.from(part.trim(), 'utf8')
    // Evaluate every entry so the timing does not reveal which one matched.
    if (
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected)
    ) {
      matched = true
    }
  }
  return matched
}
