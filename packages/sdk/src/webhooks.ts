import type { Client } from 'openapi-fetch'
import type { paths } from './generated/schema.js'
import type {
  ConversationWaitingEvent,
  ConversationWaitingEventData,
  CreateWebhookEndpointRequest,
  TriggerWebhookEventRequest,
  UpdateWebhookEndpointRequest,
  WebhookDelivery,
  WebhookDeliveryPage,
  WebhookDeliveryStatus,
  WebhookEndpoint,
  WebhookEndpointPage,
  WebhookEndpointWithSecret,
  WebhookEvent,
  WebhookEventType,
  WebhookListenFrame,
  WebhookListenReady,
  WebhookTriggerResult,
} from './models.js'
import {
  errorFromResponse,
  type SteelResult,
  settle,
  toNetworkError,
} from './result.js'
import { parseSse } from './sse.js'

/** No byte (event or `: ping` heartbeat, every 25 s) for this long = dead. */
export const DEFAULT_LISTEN_IDLE_TIMEOUT_MS = 60_000

/** Narrows a parsed delivery to `communication.conversation.waiting`. */
export function isConversationWaitingEvent(
  event: WebhookEvent | null | undefined,
): event is ConversationWaitingEvent {
  if (event?.type !== 'communication.conversation.waiting') {
    return false
  }
  const data = event.data as Partial<ConversationWaitingEventData> | null
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof data.conversation?.id === 'string' &&
    typeof data.contact?.waId === 'string'
  )
}

export interface ListDeliveriesQuery {
  endpointId?: string
  status?: WebhookDeliveryStatus
  limit?: number
  cursor?: string
}

export interface ListenOptions {
  /** Event types to receive; empty or omitted = every event. */
  events?: string[]
  /** Aborting closes the stream; the iteration ends with `aborted`. */
  signal?: AbortSignal
  /** Overrides {@link DEFAULT_LISTEN_IDLE_TIMEOUT_MS}. */
  idleTimeoutMs?: number
}

export type ListenDisconnectReason =
  /** The server closed the stream. */
  | 'end'
  /** Nothing arrived within the idle timeout. */
  | 'idle'
  /** `signal` aborted. */
  | 'aborted'
  /** The connection broke while reading. */
  | 'network'

export type ListenMessage =
  /** First message: the filter in effect and the feed's signing secret. */
  | { type: 'ready'; ready: WebhookListenReady }
  /**
   * One event. `frame` carries the exact body and the three header values
   * to forward; `event` is the parsed body (`null` if it is not JSON).
   */
  | { type: 'webhook'; frame: WebhookListenFrame; event: WebhookEvent | null }
  /** Always the last message of the iteration. */
  | { type: 'disconnected'; reason: ListenDisconnectReason; message?: string }

export interface WebhooksApi {
  events(): Promise<SteelResult<WebhookEventType[]>>
  listEndpoints(): Promise<SteelResult<WebhookEndpointPage>>
  createEndpoint(
    body: CreateWebhookEndpointRequest,
  ): Promise<SteelResult<WebhookEndpointWithSecret>>
  updateEndpoint(
    id: string,
    body: UpdateWebhookEndpointRequest,
  ): Promise<SteelResult<WebhookEndpoint>>
  deleteEndpoint(id: string): Promise<SteelResult<{ id: string }>>
  /** Sends a `steel.ping` to one endpoint now and returns the delivery. */
  testEndpoint(id: string): Promise<SteelResult<WebhookDelivery>>
  listDeliveries(
    query?: ListDeliveriesQuery,
  ): Promise<SteelResult<WebhookDeliveryPage>>
  retryDelivery(id: string): Promise<SteelResult<WebhookDelivery>>
  /** `steel trigger`: a test event with the catalog's sample data. */
  trigger(
    body: TriggerWebhookEventRequest,
  ): Promise<SteelResult<WebhookTriggerResult>>
  /**
   * Opens `GET /api/v1/webhooks/listen` (SSE). HTTP errors (401, 403, 429,
   * bad filter) come back as `ok: false` before any message; once open, the
   * iterable never throws and always ends with a `disconnected` message.
   * One connection only: reconnecting is up to the caller.
   */
  listen(
    options?: ListenOptions,
  ): Promise<SteelResult<AsyncIterable<ListenMessage>>>
}

export interface WebhooksDeps {
  api: Client<paths>
  baseUrl: string
  headers: Record<string, string>
  fetch: typeof globalThis.fetch
  /** Applies to the SSE connection until the response headers arrive. */
  timeoutMs: number
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asReady(value: unknown): WebhookListenReady | undefined {
  if (!isRecord(value) || typeof value.workspaceId !== 'string') return
  if (typeof value.secret !== 'string' || !Array.isArray(value.events)) return
  return value as unknown as WebhookListenReady
}

function asFrame(value: unknown): WebhookListenFrame | undefined {
  if (!isRecord(value)) return
  if (typeof value.id !== 'string' || typeof value.body !== 'string') return
  if (typeof value.signature !== 'string') return
  if (typeof value.timestamp !== 'number') return
  return value as unknown as WebhookListenFrame
}

async function readErrorBody(response: Response): Promise<unknown> {
  try {
    return parseJson(await response.text())
  } catch {
    return undefined
  }
}

export function createWebhooksApi(deps: WebhooksDeps): WebhooksApi {
  const { api } = deps
  const id = (value: string) => ({ params: { path: { id: value } } })

  async function listen(
    options: ListenOptions = {},
  ): Promise<SteelResult<AsyncIterable<ListenMessage>>> {
    const url = new URL(`${deps.baseUrl}/api/v1/webhooks/listen`)
    const events = (options.events ?? []).filter(Boolean)
    if (events.length > 0) url.searchParams.set('events', events.join(','))

    const controller = new AbortController()
    let reason: ListenDisconnectReason | undefined
    const stop = (why: ListenDisconnectReason) => {
      reason ??= why
      controller.abort()
    }
    const onAbort = () => stop('aborted')
    if (options.signal?.aborted) onAbort()
    options.signal?.addEventListener('abort', onAbort, { once: true })
    const cleanup = () => options.signal?.removeEventListener('abort', onAbort)

    const connectTimer = setTimeout(() => stop('idle'), deps.timeoutMs)
    let response: Response
    try {
      response = await deps.fetch(url, {
        method: 'GET',
        headers: {
          ...deps.headers,
          accept: 'text/event-stream',
          'cache-control': 'no-cache',
        },
        signal: controller.signal,
      })
    } catch (cause) {
      cleanup()
      const error = toNetworkError(cause)
      if (reason === 'idle') error.code = 'TIMEOUT'
      return { ok: false, error }
    } finally {
      clearTimeout(connectTimer)
    }

    if (!response.ok || !response.body) {
      cleanup()
      const body = await readErrorBody(response)
      controller.abort()
      return { ok: false, error: errorFromResponse(response, body) }
    }

    const idleMs = options.idleTimeoutMs ?? DEFAULT_LISTEN_IDLE_TIMEOUT_MS
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const touch = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => stop('idle'), idleMs)
    }
    touch()
    const watched = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, out) {
          touch()
          out.enqueue(chunk)
        },
      }),
      { signal: controller.signal },
    )

    async function* messages(): AsyncGenerator<ListenMessage> {
      let failure: string | undefined
      try {
        for await (const message of parseSse(watched)) {
          const data = parseJson(message.data)
          if (message.event === 'ready') {
            const ready = asReady(data)
            if (ready) yield { type: 'ready', ready }
          } else if (message.event === 'webhook') {
            const frame = asFrame(data)
            if (!frame) continue
            const event = parseJson(frame.body)
            yield {
              type: 'webhook',
              frame,
              event: isRecord(event)
                ? (event as unknown as WebhookEvent)
                : null,
            }
          }
        }
      } catch (cause) {
        failure = cause instanceof Error ? cause.message : String(cause)
      } finally {
        if (idleTimer) clearTimeout(idleTimer)
        cleanup()
        controller.abort()
      }
      const why = reason ?? (failure === undefined ? 'end' : 'network')
      yield {
        type: 'disconnected',
        reason: why,
        ...(why === 'network' && failure ? { message: failure } : {}),
      }
    }

    return { ok: true, status: response.status, data: messages() }
  }

  return {
    events: () =>
      settle<WebhookEventType[]>(api.GET('/api/v1/webhooks/events')),
    listEndpoints: () =>
      settle<WebhookEndpointPage>(api.GET('/api/v1/webhooks/endpoints')),
    createEndpoint: (body) =>
      settle<WebhookEndpointWithSecret>(
        api.POST('/api/v1/webhooks/endpoints', { body }),
      ),
    updateEndpoint: (endpointId, body) =>
      settle<WebhookEndpoint>(
        api.PATCH('/api/v1/webhooks/endpoints/{id}', {
          ...id(endpointId),
          body,
        }),
      ),
    deleteEndpoint: (endpointId) =>
      settle<{ id: string }>(
        api.DELETE('/api/v1/webhooks/endpoints/{id}', id(endpointId)),
      ),
    testEndpoint: (endpointId) =>
      settle<WebhookDelivery>(
        api.POST('/api/v1/webhooks/endpoints/{id}/test', id(endpointId)),
      ),
    listDeliveries: (query = {}) =>
      settle<WebhookDeliveryPage>(
        api.GET('/api/v1/webhooks/deliveries', { params: { query } }),
      ),
    retryDelivery: (deliveryId) =>
      settle<WebhookDelivery>(
        api.POST('/api/v1/webhooks/deliveries/{id}/retry', id(deliveryId)),
      ),
    trigger: (body) =>
      settle<WebhookTriggerResult>(
        api.POST('/api/v1/webhooks/trigger', { body }),
      ),
    listen,
  }
}
