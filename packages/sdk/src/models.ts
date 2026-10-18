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
