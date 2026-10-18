import createClient, { type Client } from 'openapi-fetch'
import type { paths } from './generated/schema.js'
import type {
  DeviceAuthorization,
  DeviceAuthorizationRequest,
  DeviceToken,
  Me,
} from './models.js'
import {
  type CrmResource,
  crmResource,
  type ServicedeskResource,
  servicedeskResource,
  settle,
  type WhatsAppResource,
  whatsappResource,
} from './resources.js'
import { type SteelResult, toNetworkError } from './result.js'

export interface SteelClientOptions {
  /** Steel origin, e.g. `https://homologacao.stratustelecom.com.br`. */
  baseUrl: string
  /** Personal API token (`stl_pat_...`). Not needed for the device flow. */
  token?: string
  /** Defaults to `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch
  userAgent?: string
  /** Per-request timeout in milliseconds. Defaults to 30 s. */
  timeoutMs?: number
}

export interface RawRequest {
  method: string
  /** Absolute path on the Steel origin, e.g. `/api/v1/me`. */
  path: string
  query?: Record<string, string | string[]>
  body?: unknown
}

export interface RawResponse {
  status: number
  ok: boolean
  headers: Headers
  /** Parsed JSON when the response is JSON, the text otherwise. */
  body: unknown
}

export interface SteelClient {
  /** Fully typed `openapi-fetch` client over the v1 document. */
  api: Client<paths>
  me(): Promise<SteelResult<Me>>
  servicedesk: ServicedeskResource
  crm: CrmResource
  whatsapp: WhatsAppResource
  auth: {
    startDevice(
      body?: DeviceAuthorizationRequest,
    ): Promise<SteelResult<DeviceAuthorization>>
    pollDeviceToken(deviceCode: string): Promise<SteelResult<DeviceToken>>
  }
  /**
   * Untyped call for routes the SDK does not model yet (`steel api`). Only
   * transport failures come back as `ok: false`; HTTP errors are a
   * `RawResponse` with `ok: false` inside.
   */
  request(request: RawRequest): Promise<SteelResult<RawResponse>>
}

const DEFAULT_TIMEOUT_MS = 30_000

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return null
  const type = response.headers.get('content-type') ?? ''
  if (type.includes('json')) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return text
}

export function createSteelClient(options: SteelClientOptions): SteelClient {
  const baseUrl = trimTrailingSlash(options.baseUrl)
  const fetchImpl = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const anonymous: Record<string, string> = { accept: 'application/json' }
  if (options.userAgent) anonymous['user-agent'] = options.userAgent
  const headers = { ...anonymous }
  if (options.token) headers.authorization = `Bearer ${options.token}`

  const timedFetch = (input: Request) =>
    fetchImpl(input, { signal: AbortSignal.timeout(timeoutMs) })

  const api = createClient<paths>({ baseUrl, headers, fetch: timedFetch })
  // The device flow endpoints are anonymous: never send a stale token there.
  const anonymousApi = createClient<paths>({
    baseUrl,
    headers: anonymous,
    fetch: timedFetch,
  })

  return {
    api,
    me: () => settle<Me>(api.GET('/api/v1/me')),
    servicedesk: servicedeskResource(api),
    crm: crmResource(api),
    whatsapp: whatsappResource(api),
    auth: {
      startDevice: (body = {}) =>
        settle<DeviceAuthorization>(
          anonymousApi.POST('/api/v1/auth/device', { body }),
        ),
      pollDeviceToken: (deviceCode) =>
        settle<DeviceToken>(
          anonymousApi.POST('/api/v1/auth/device/token', {
            body: { deviceCode },
          }),
        ),
    },
    async request({ method, path, query, body }) {
      const url = new URL(`${baseUrl}${path}`)
      for (const [key, value] of Object.entries(query ?? {})) {
        for (const item of Array.isArray(value) ? value : [value]) {
          url.searchParams.append(key, item)
        }
      }
      const init: RequestInit = {
        method: method.toUpperCase(),
        headers: { ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      }
      if (body !== undefined) {
        init.body = JSON.stringify(body)
        ;(init.headers as Record<string, string>)['content-type'] =
          'application/json'
      }
      try {
        const response = await fetchImpl(url, init)
        return {
          ok: true,
          status: response.status,
          data: {
            status: response.status,
            ok: response.ok,
            headers: response.headers,
            body: await readBody(response),
          },
        }
      } catch (cause) {
        return { ok: false, error: toNetworkError(cause) }
      }
    },
  }
}
