import type { components, operations } from './generated/schema.js'

type Schemas = components['schemas']

/** JSON body of an operation's request. */
type RequestBody<Op extends keyof operations> =
  NonNullable<operations[Op]['requestBody']> extends {
    content: { 'application/json': infer T }
  }
    ? T
    : never

/**
 * `data` of an operation's success envelope. The v1 document types every
 * 2xx body as `SuccessEnvelope & { data?: T }`, hence the `NonNullable`.
 */
type ResponseData<
  Op extends keyof operations,
  Status extends keyof operations[Op]['responses'],
> = operations[Op]['responses'][Status] extends {
  content: { 'application/json': { data?: infer T } }
}
  ? NonNullable<T>
  : never

/** One item of a cursor page returned by an operation. */
type PageItem<
  Op extends keyof operations,
  Status extends keyof operations[Op]['responses'],
> = ResponseData<Op, Status> extends { items: (infer T)[] } ? T : never

export type ApiScope = Schemas['ApiScope']
export type ModuleKind = Schemas['ModuleKind']
export type WorkspaceRef = Schemas['WorkspaceRef']
export type DeviceAuthorizationRequest = Schemas['DeviceAuthorizationRequest']
export type DeviceAuthorization = Schemas['DeviceAuthorization']
export type DeviceToken = Schemas['DeviceToken']
export type Me = Schemas['Me']
export type ErrorEnvelope = Schemas['ErrorEnvelope']
/** Every `error.code` the v1 document declares. */
export type ErrorCode = Schemas['ErrorCode']

/** One page of a cursor list (`?limit=&cursor=`). */
export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export type SdTicket = Schemas['SdTicket']
export type SdTicketType = SdTicket['type']
export type SdPhaseSummary = Schemas['SdPhaseSummary']
export type SdPhaseCategory = SdPhaseSummary['category']
export type SdUserSummary = Schemas['SdUserSummary']
export type SdTicketCreate = RequestBody<'createTicket'>
export type SdTicketMessage = Schemas['SdTicketMessage']
export type SdCatalogItem = PageItem<'listCatalog', 200>
/** A phase of the ticket workflow (`GET /servicedesk/phases`). */
export type SdPhase = Schemas['ApiV1SdPhase']
export type CrmLead = Schemas['CrmLead']
export type CrmLeadStage = CrmLead['stage']
export type CrmLeadCreate = RequestBody<'createLead'>
export type CrmLeadImportResult = Schemas['ApiV1LeadImportResult']
export type CrmOpportunity = Schemas['CrmOpportunity']
export type CrmPipeline = Schemas['ApiV1CrmPipeline']
export type CrmPipelineStage = Schemas['CrmPipelineStage']
export type WhatsAppTemplate = Schemas['WhatsAppTemplate']
export type WhatsAppTemplateSend = RequestBody<'sendTemplate'>
export type WhatsAppMessage = Schemas['WhatsAppMessage']
export type WhatsAppBroadcast = Schemas['WhatsAppBroadcastDetail']
export type WhatsAppConversation = Schemas['WhatsAppConversation']
export type WhatsAppConversationStatus = WhatsAppConversation['status']

export type WebhookEventType = Schemas['WebhookEventType']
export type WebhookEventModule = WebhookEventType['module']
export type WebhookEndpoint = Schemas['WebhookEndpoint']
export type WebhookEndpointPage = Page<WebhookEndpoint>
export type WebhookEndpointWithSecret = ResponseData<
  'postWebhooksEndpoints',
  201
>
export type CreateWebhookEndpointRequest = RequestBody<'postWebhooksEndpoints'>
export type UpdateWebhookEndpointRequest =
  RequestBody<'patchWebhooksEndpointsById'>
/** Event types an endpoint can subscribe to (`*` = all of them). */
export type WebhookSubscription = CreateWebhookEndpointRequest['events'][number]
/** Every event type the v1 document knows, `steel.ping` included. */
export type WebhookEventName = WebhookEventType['type']
export type WebhookDelivery = Schemas['WebhookDelivery']
export type WebhookDeliveryStatus = WebhookDelivery['status']
export type WebhookDeliveryPage = Page<WebhookDelivery>
export type TriggerWebhookEventRequest = RequestBody<'postWebhooksTrigger'>
export type WebhookTriggerResult = ResponseData<'postWebhooksTrigger', 202>

/**
 * The SSE stream and the delivery body are not JSON operations, so the v1
 * document has no schema for them; these follow ADR 0036.
 */

/** Body of every webhook delivery (and of each `listen` frame). */
export interface WebhookEvent {
  id: string
  type: string
  /** ISO 8601. */
  createdAt: string
  workspaceId: string
  data: unknown
}

/**
 * `data` of `communication.conversation.waiting`: a Comunicação conversation
 * just entered the agents' queue (open, not archived, no assignee).
 */
export interface ConversationWaitingEventData {
  conversation: {
    id: string
    status: 'NEW' | 'IN_PROGRESS'
    connectionId: string
    /** Team queue it waits in; `null` = the general queue. */
    teamId: string | null
    /** The AI is answering it meanwhile. */
    aiActive: boolean
    unreadCount: number
    lastMessageAt: string | null
    createdAt: string
  }
  contact: { id: string; waId: string; name: string | null }
  /** How it got into the queue. */
  reason: 'new' | 'reopened' | 'returned_to_queue'
  /** Who did it; `null` = the contact or the system. */
  actorId: string | null
}

export type ConversationWaitingEvent = WebhookEvent & {
  type: 'communication.conversation.waiting'
  data: ConversationWaitingEventData
}

/** Data of the first SSE message (`event: ready`) of `listen`. */
export interface WebhookListenReady {
  workspaceId: string
  /** Filter in effect; empty means every event. */
  events: string[]
  /** Signing secret of this member's listen feed. */
  secret: string
}

/** Data of each `event: webhook` SSE message. */
export interface WebhookListenFrame {
  id: string
  /** Unix seconds (`Steel-Webhook-Timestamp`). */
  timestamp: number
  /** `Steel-Signature` header value (`v1=<hex>`). */
  signature: string
  /** Exact JSON body of the event. */
  body: string
}
