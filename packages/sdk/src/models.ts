import type { components } from './generated/schema.js'

type Schemas = components['schemas']

export type ApiScope = Schemas['ApiScope']
export type ModuleKind = Schemas['ModuleKind']
export type WorkspaceRef = Schemas['WorkspaceRef']
export type DeviceAuthorizationRequest = Schemas['DeviceAuthorizationRequest']
export type DeviceAuthorization = Schemas['DeviceAuthorization']
export type DeviceToken = Schemas['DeviceToken']
export type Me = Schemas['Me']
export type ErrorEnvelope = Schemas['ErrorEnvelope']

/** One page of a cursor list (`?limit=&cursor=`). */
export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export type SdTicketType = Schemas['SdTicketType']
export type SdPhaseCategory = Schemas['SdPhaseCategory']
export type SdPhaseSummary = Schemas['SdPhaseSummary']
export type SdUserSummary = Schemas['SdUserSummary']
export type SdTicket = Schemas['SdTicket']
export type SdTicketCreate = Schemas['SdTicketCreate']
export type SdTicketMessage = Schemas['SdTicketMessage']
export type SdCatalogItem = Schemas['SdCatalogItem']
export type CrmLeadStage = Schemas['CrmLeadStage']
export type CrmLead = Schemas['CrmLead']
export type CrmLeadCreate = Schemas['CrmLeadCreate']
export type CrmLeadImportResult = Schemas['CrmLeadImportResult']
export type CrmOpportunity = Schemas['CrmOpportunity']
export type CrmPipeline = Schemas['CrmPipeline']
export type CrmPipelineStage = Schemas['CrmPipelineStage']
export type WhatsAppTemplate = Schemas['WhatsAppTemplate']
export type WhatsAppTemplateSend = Schemas['WhatsAppTemplateSend']
export type WhatsAppMessage = Schemas['WhatsAppMessage']
export type WhatsAppBroadcast = Schemas['WhatsAppBroadcast']

export type WebhookEventModule = Schemas['WebhookEventModule']
export type WebhookEventType = Schemas['WebhookEventType']
export type WebhookEndpoint = Schemas['WebhookEndpoint']
export type WebhookEndpointPage = Schemas['WebhookEndpointPage']
export type WebhookEndpointWithSecret = Schemas['WebhookEndpointWithSecret']
export type CreateWebhookEndpointRequest =
  Schemas['CreateWebhookEndpointRequest']
export type UpdateWebhookEndpointRequest =
  Schemas['UpdateWebhookEndpointRequest']
export type WebhookDeliveryStatus = Schemas['WebhookDeliveryStatus']
export type WebhookDelivery = Schemas['WebhookDelivery']
export type WebhookDeliveryPage = Schemas['WebhookDeliveryPage']
export type TriggerWebhookEventRequest = Schemas['TriggerWebhookEventRequest']
export type WebhookTriggerResult = Schemas['WebhookTriggerResult']
export type WebhookEvent = Schemas['WebhookEvent']
export type WebhookListenReady = Schemas['WebhookListenReady']
export type WebhookListenFrame = Schemas['WebhookListenFrame']
