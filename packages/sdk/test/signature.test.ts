import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOLERANCE_SECONDS,
  signPayload,
  verifySignature,
  WEBHOOK_HEADERS,
} from '../src/index.js'

const secret = 'whsec_test_secret'
const body = '{"id":"evt_1","type":"crm.lead.created","data":{"name":"Ana"}}'
const timestamp = 1_760_788_800

describe('signPayload', () => {
  it('is v1=<hex HMAC-SHA256 of "<timestamp>.<body>">', () => {
    const hex = createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex')
    expect(signPayload(secret, timestamp, body)).toBe(`v1=${hex}`)
    expect(signPayload(secret, String(timestamp), body)).toBe(`v1=${hex}`)
  })

  it('names the three headers like the Steel app', () => {
    expect(WEBHOOK_HEADERS).toEqual({
      id: 'Steel-Webhook-Id',
      timestamp: 'Steel-Webhook-Timestamp',
      signature: 'Steel-Signature',
    })
    expect(DEFAULT_TOLERANCE_SECONDS).toBe(300)
  })
})

describe('verifySignature', () => {
  const header = signPayload(secret, timestamp, body)
  const now = { nowSeconds: timestamp + 10 }

  it('accepts a valid signature, with the timestamp as string or number', () => {
    expect(verifySignature(secret, header, String(timestamp), body, now)).toBe(
      true,
    )
    expect(verifySignature(secret, header, timestamp, body, now)).toBe(true)
  })

  it('accepts any entry of a comma-separated header (secret rotation)', () => {
    const other = signPayload('whsec_old', timestamp, body)
    expect(
      verifySignature(secret, `${other}, ${header}`, timestamp, body, now),
    ).toBe(true)
  })

  it('rejects a changed body, a wrong secret or a tampered signature', () => {
    expect(verifySignature(secret, header, timestamp, `${body} `, now)).toBe(
      false,
    )
    expect(verifySignature('whsec_other', header, timestamp, body, now)).toBe(
      false,
    )
    const tampered = `${header.slice(0, -1)}${header.endsWith('0') ? '1' : '0'}`
    expect(verifySignature(secret, tampered, timestamp, body, now)).toBe(false)
    expect(verifySignature(secret, 'v1=short', timestamp, body, now)).toBe(
      false,
    )
  })

  it('rejects missing or malformed inputs without throwing', () => {
    expect(verifySignature('', header, timestamp, body, now)).toBe(false)
    expect(verifySignature(secret, null, timestamp, body, now)).toBe(false)
    expect(verifySignature(secret, undefined, timestamp, body, now)).toBe(false)
    expect(verifySignature(secret, header, null, body, now)).toBe(false)
    expect(verifySignature(secret, header, undefined, body, now)).toBe(false)
    expect(verifySignature(secret, header, 'abc', body, now)).toBe(false)
    expect(verifySignature(secret, header, '1.5', body, now)).toBe(false)
  })

  it('enforces the tolerance unless it is 0', () => {
    const late = { nowSeconds: timestamp + DEFAULT_TOLERANCE_SECONDS + 1 }
    expect(verifySignature(secret, header, timestamp, body, late)).toBe(false)
    expect(
      verifySignature(secret, header, timestamp, body, {
        nowSeconds: timestamp - 61,
        toleranceSeconds: 60,
      }),
    ).toBe(false)
    expect(
      verifySignature(secret, header, timestamp, body, {
        ...late,
        toleranceSeconds: 0,
      }),
    ).toBe(true)
  })

  it('uses the current clock by default', () => {
    const fresh = Math.floor(Date.now() / 1000)
    const signed = signPayload(secret, fresh, body)
    expect(verifySignature(secret, signed, fresh, body)).toBe(true)
    expect(verifySignature(secret, header, timestamp, body)).toBe(false)
  })
})
