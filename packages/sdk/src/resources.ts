import type { Client } from 'openapi-fetch'
import type { operations, paths } from './generated/schema.js'
import type {
  CrmLead,
  CrmLeadCreate,
  CrmLeadImportResult,
  CrmOpportunity,
  CrmPipeline,
  Page,
  SdCatalogItem,
  SdTicket,
  SdTicketCreate,
  SdTicketMessage,
  WhatsAppBroadcast,
  WhatsAppMessage,
  WhatsAppTemplate,
  WhatsAppTemplateSend,
} from './models.js'
import { type SteelResult, settle } from './result.js'

type Query<Op extends keyof operations> = NonNullable<
  operations[Op]['parameters']['query']
>

export type SdTicketListQuery = Query<'listTickets'>
export type SdCatalogQuery = Query<'listCatalog'>
export type CrmLeadListQuery = Query<'listLeads'>
export type CrmOpportunityListQuery = Query<'listOpportunities'>
export type CrmPipelineListQuery = Query<'listPipelines'>
export type WhatsAppTemplateListQuery = Query<'listTemplates'>

export interface SdTicketComment {
  body: string
  visibility?: 'PUBLIC' | 'INTERNAL'
}

export interface SdTicketMove {
  phaseId: string
  solution?: string
  solutionClassificationId?: string
  comment?: string
}

export interface CrmOpportunityMove {
  stageId: string
  pipelineId?: string
}

/** ServiceDesk routes of the API v1 (`docs/cli/README.md`). */
export function servicedeskResource(api: Client<paths>) {
  return {
    tickets: {
      list: (query: SdTicketListQuery = {}) =>
        settle<Page<SdTicket>>(
          api.GET('/api/v1/servicedesk/tickets', { params: { query } }),
        ),
      /** Accepts the ticket id or its number. */
      get: (ticketId: string) =>
        settle<SdTicket>(
          api.GET('/api/v1/servicedesk/tickets/{ticketId}', {
            params: { path: { ticketId } },
          }),
        ),
      create: (body: SdTicketCreate) =>
        settle<SdTicket>(api.POST('/api/v1/servicedesk/tickets', { body })),
      comment: (ticketId: string, body: SdTicketComment) =>
        settle<SdTicketMessage>(
          api.POST('/api/v1/servicedesk/tickets/{ticketId}/comments', {
            params: { path: { ticketId } },
            body,
          }),
        ),
      move: (ticketId: string, body: SdTicketMove) =>
        settle<SdTicket>(
          api.POST('/api/v1/servicedesk/tickets/{ticketId}/phase', {
            params: { path: { ticketId } },
            body,
          }),
        ),
    },
    catalog: (query: SdCatalogQuery = {}) =>
      settle<Page<SdCatalogItem>>(
        api.GET('/api/v1/servicedesk/catalog', { params: { query } }),
      ),
  }
}

/** CRM routes of the API v1. */
export function crmResource(api: Client<paths>) {
  return {
    leads: {
      list: (query: CrmLeadListQuery = {}) =>
        settle<Page<CrmLead>>(
          api.GET('/api/v1/crm/leads', { params: { query } }),
        ),
      create: (body: CrmLeadCreate) =>
        settle<CrmLead>(api.POST('/api/v1/crm/leads', { body })),
      /** Sends the CSV as is (`text/csv`, up to 5,000 rows). */
      import: (csv: string, query: { source?: string } = {}) =>
        settle<CrmLeadImportResult>(
          api.POST('/api/v1/crm/leads/import', {
            params: { query },
            body: csv,
            bodySerializer: (body: string) => body,
            headers: { 'content-type': 'text/csv; charset=utf-8' },
          }),
        ),
    },
    opportunities: {
      list: (query: CrmOpportunityListQuery = {}) =>
        settle<Page<CrmOpportunity>>(
          api.GET('/api/v1/crm/opportunities', { params: { query } }),
        ),
      move: (opportunityId: string, body: CrmOpportunityMove) =>
        settle<CrmOpportunity>(
          api.POST('/api/v1/crm/opportunities/{opportunityId}/stage', {
            params: { path: { opportunityId } },
            body,
          }),
        ),
    },
    pipelines: (query: CrmPipelineListQuery = {}) =>
      settle<Page<CrmPipeline>>(
        api.GET('/api/v1/crm/pipelines', { params: { query } }),
      ),
  }
}

/** Comunicação (WhatsApp) routes of the API v1. */
export function whatsappResource(api: Client<paths>) {
  return {
    templates: (query: WhatsAppTemplateListQuery = {}) =>
      settle<Page<WhatsAppTemplate>>(
        api.GET('/api/v1/whatsapp/templates', { params: { query } }),
      ),
    sendTemplate: (body: WhatsAppTemplateSend) =>
      settle<WhatsAppMessage>(
        api.POST('/api/v1/whatsapp/messages/template', { body }),
      ),
    broadcast: (broadcastId: string) =>
      settle<WhatsAppBroadcast>(
        api.GET('/api/v1/whatsapp/broadcasts/{broadcastId}', {
          params: { path: { broadcastId } },
        }),
      ),
  }
}

export type ServicedeskResource = ReturnType<typeof servicedeskResource>
export type CrmResource = ReturnType<typeof crmResource>
export type WhatsAppResource = ReturnType<typeof whatsappResource>

/**
 * Walks every page of a cursor list, `limit` items per request, until
 * `nextCursor` is null. Stops at the first error.
 */
export async function collectAll<T>(
  fetchPage: (cursor: string | undefined) => Promise<SteelResult<Page<T>>>,
): Promise<SteelResult<Page<T>>> {
  const items: T[] = []
  let cursor: string | undefined
  let status = 200
  do {
    const result = await fetchPage(cursor)
    if (!result.ok) return result
    status = result.status
    items.push(...result.data.items)
    const next = result.data.nextCursor ?? undefined
    // A server that hands back the same cursor would loop forever.
    cursor = next === cursor ? undefined : next
  } while (cursor)
  return { ok: true, status, data: { items, nextCursor: null } }
}
