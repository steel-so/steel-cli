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
