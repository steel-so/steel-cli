import type { CrmPipeline } from '@steel-so/sdk'
import { vi } from 'vitest'
import type { Choice, Prompter } from '../src/lib/prompt.js'
import { type HarnessOptions, harness } from './harness.js'

export const BASE = 'https://homologacao.stratustelecom.com.br'

/** A logged-in harness; `prompt` answers make it interactive (TTY). */
export async function domainHarness(
  options: HarnessOptions & { answers?: Array<string | boolean> } = {},
) {
  const { answers, ...rest } = options
  const h = harness({ ...rest, tty: rest.tty ?? answers !== undefined })
  await h.keychain?.set('homologacao', 'stl_pat_saved')
  const prompt = answers ? scriptedPrompter(answers) : undefined
  if (prompt) {
    h.deps.prompt = prompt
    h.deps.confirm = prompt.confirm
  }
  return { ...h, prompt }
}

/** Replies from a queue and records every question. */
export function scriptedPrompter(answers: Array<string | boolean>) {
  const questions: string[] = []
  const choices: Choice[][] = []
  const next = (question: string) => {
    questions.push(question)
    if (answers.length === 0) throw new Error(`unexpected prompt: ${question}`)
    return answers.shift() as string | boolean
  }
  const prompter: Prompter & {
    questions: string[]
    choices: Choice[][]
    confirm: (message: string) => Promise<boolean>
  } = {
    questions,
    choices,
    text: vi.fn(async (message: string) => String(next(message))),
    select: vi.fn(async (message: string, list: Choice[]) => {
      choices.push(list)
      return String(next(message)) as never
    }),
    confirm: vi.fn(async (message: string) => Boolean(next(message))),
  }
  return prompter
}

export const path = (request: Request | undefined) => {
  const url = new URL(request?.url ?? 'http://x')
  return `${request?.method} ${url.pathname}${url.search}`
}

const user = (name: string) => ({
  id: `u_${name}`,
  name,
  email: `${name.toLowerCase()}@example.com`,
  image: null,
})

const clock = (
  state: string,
  remainingMinutes: number | null = 90,
): Record<string, unknown> => ({
  dueAt: '2099-01-15T12:00:00.000Z',
  remainingMinutes,
  percentUsed: 40,
  state,
})

export function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tk_1',
    number: 42,
    code: 'INC-42',
    type: 'INCIDENT',
    title: 'VPN fora do ar',
    description: 'Ninguém conecta desde as 9h.',
    channel: 'API',
    phaseId: 'ph_new',
    phase: {
      id: 'ph_new',
      name: 'Novo',
      color: null,
      category: 'NEW',
      completionPercent: 0,
      position: 0,
    },
    completionPercent: 0,
    priority: { id: 'pr_1', name: 'Alta', level: 1, color: null },
    category: { id: 'cat_1', name: 'Rede', color: null },
    subcategory: null,
    service: { id: 'svc_1', name: 'VPN', color: null },
    assignee: user('Bruno'),
    requester: user('Ana'),
    tags: ['rede'],
    sla: { firstResponse: clock('met'), resolution: clock('ok') },
    resolvedAt: null,
    closedAt: null,
    lastActivityAt: '2099-01-10T12:00:00.000Z',
    createdAt: '2099-01-10T09:00:00.000Z',
    updatedAt: '2099-01-10T12:00:00.000Z',
    ...overrides,
  }
}

export { clock }

export const catalogItems = [
  {
    id: 'cat_1',
    parentId: null,
    level: 'CATEGORY',
    name: 'Rede',
    description: null,
    ticketTypes: [],
    active: true,
    position: 0,
  },
  {
    id: 'svc_1',
    parentId: 'cat_1',
    level: 'SERVICE',
    name: 'VPN',
    description: null,
    ticketTypes: ['INCIDENT', 'SERVICE_REQUEST'],
    active: true,
    position: 1,
  },
  {
    id: 'svc_old',
    parentId: 'missing',
    level: 'SERVICE',
    name: 'Fax',
    description: null,
    ticketTypes: ['INCIDENT'],
    active: false,
    position: 2,
  },
]

export function lead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ld_1',
    name: 'Carla Dias',
    emails: ['carla@example.com'],
    phones: [],
    company: 'Acme',
    jobTitle: null,
    city: null,
    source: 'CLI',
    channel: null,
    stage: 'RECEIVED',
    score: 30,
    ownerId: null,
    createdAt: '2099-01-10T09:00:00.000Z',
    updatedAt: '2099-01-10T09:00:00.000Z',
    ...overrides,
  }
}

const STAMP = '2099-01-01T00:00:00.000Z'
const audit = {
  workspaceId: 'ws_1',
  createdById: 'u_Ana',
  updatedById: null,
  createdAt: STAMP,
  updatedAt: STAMP,
}

export const pipelineList: CrmPipeline[] = [
  {
    id: 'pl_sales',
    name: 'Vendas',
    position: 0,
    isDefault: true,
    ...audit,
    stages: [
      {
        id: 'st_won',
        pipelineId: 'pl_sales',
        name: 'Ganho',
        position: 2,
        probability: 100,
        category: 'WON',
        color: null,
        createdAt: STAMP,
        updatedAt: STAMP,
      },
      {
        id: 'st_prop',
        pipelineId: 'pl_sales',
        name: 'Proposta',
        position: 1,
        probability: 60,
        category: 'OPEN',
        color: null,
        createdAt: STAMP,
        updatedAt: STAMP,
      },
    ],
  },
  {
    id: 'pl_renew',
    name: 'Renovação',
    position: 1,
    isDefault: false,
    ...audit,
    stages: [
      {
        id: 'st_renew_prop',
        pipelineId: 'pl_renew',
        name: 'Proposta',
        position: 0,
        probability: 50,
        category: 'OPEN',
        color: null,
        createdAt: STAMP,
        updatedAt: STAMP,
      },
    ],
  },
  {
    id: 'pl_empty',
    name: 'Vazio',
    position: 2,
    isDefault: false,
    ...audit,
    stages: [],
  },
]

export function opportunity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'op_1',
    name: 'Acme — 50 ramais',
    amount: 12500.5,
    probability: 60,
    closeDate: '2099-02-01T12:00:00.000Z',
    pipelineId: 'pl_sales',
    stageId: 'st_prop',
    ownerId: null,
    createdAt: '2099-01-10T09:00:00.000Z',
    updatedAt: '2099-01-10T09:00:00.000Z',
    ...overrides,
  }
}

export function template(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tpl_1',
    connectionId: 'conn_1',
    name: 'boas_vindas',
    language: 'pt_BR',
    category: 'MARKETING',
    status: 'APPROVED',
    quality: 'GREEN',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Oi {{1}}' },
      { type: 'BODY', text: 'Olá {{1}}, seu código é {{2}}. {{1}}!' },
      { type: 'FOOTER', text: 'Steel' },
    ],
    ...overrides,
  }
}

export function broadcast(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bc_1',
    connectionId: 'conn_1',
    name: 'Black Friday',
    status: 'RUNNING',
    scheduledAt: null,
    recipientCount: 10,
    sentCount: 5,
    failedCount: 1,
    skippedCount: 0,
    createdAt: '2099-01-10T09:00:00.000Z',
    updatedAt: '2099-01-10T09:30:00.000Z',
    recipients: [
      {
        id: 'r1',
        contactId: 'c1',
        contactName: 'Dani',
        contactWaId: '5511999990001',
        status: 'FAILED',
        errorMessage: 'Número sem WhatsApp',
        sentAt: null,
      },
      {
        id: 'r2',
        contactId: 'c2',
        contactName: null,
        contactWaId: '5511999990002',
        status: 'SENT',
        errorMessage: null,
        sentAt: '2099-01-10T09:10:00.000Z',
      },
    ],
    ...overrides,
  }
}

export const page = (items: unknown[], nextCursor: string | null = null) => ({
  items,
  nextCursor,
})
