import type { WhatsAppTemplate, WhatsAppTemplateSend } from '@steel-so/sdk'
import { Box, Text } from 'ink'
import type { Context } from '../context.js'
import { usageError } from '../errors.js'
import {
  confirmWrite,
  fetchAll,
  fetchPages,
  type PageOptions,
  parseEnum,
  required,
  truncate,
  unwrap,
} from '../lib/domain.js'
import { formatDate } from '../lib/format.js'
import { Code, Hint, KeyValue, Success, Table } from '../ui/components.js'
import {
  BROADCAST_STATUS_LABELS,
  label,
  progressBar,
  QUALITY_LABELS,
  TEMPLATE_STATUS_LABELS,
  TEMPLATE_STATUSES,
} from '../ui/labels.js'
import { printPage } from '../ui/page.js'
import { theme } from '../ui/theme.js'

/* ------------------------------------------------------------------ */
/* Template variables                                                   */
/* ------------------------------------------------------------------ */

interface TemplateComponent {
  type?: string
  format?: string
  text?: string
}

export interface TemplateVariables {
  header: string[]
  body: string[]
}

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g

function placeholders(text: string | undefined): string[] {
  const names = [...(text ?? '').matchAll(PLACEHOLDER)].map(
    (match) => match[1] as string,
  )
  return [...new Set(names)]
}

function component(
  template: WhatsAppTemplate,
  type: string,
): TemplateComponent | undefined {
  return (template.components as TemplateComponent[]).find(
    (item) => item?.type?.toUpperCase() === type,
  )
}

/** `{{1}}`/`{{nome}}` placeholders of the text header and the body. */
export function templateVariables(
  template: WhatsAppTemplate,
): TemplateVariables {
  const header = component(template, 'HEADER')
  return {
    header:
      header && (header.format ?? 'TEXT').toUpperCase() === 'TEXT'
        ? placeholders(header.text)
        : [],
    body: placeholders(component(template, 'BODY')?.text),
  }
}

/** Keys the user passes with `--var`: body as is, header as `header.<k>`. */
export function variableKeys(variables: TemplateVariables): string[] {
  return [...variables.header.map((key) => `header.${key}`), ...variables.body]
}

export function parseVars(pairs: string[] = []): Record<string, string> {
  const values: Record<string, string> = {}
  for (const pair of pairs) {
    const index = pair.indexOf('=')
    if (index <= 0) {
      throw usageError(
        `Variável inválida: ${pair}`,
        'Use --var chave=valor, ex.: --var 1=Ana ou --var nome=Ana.',
      )
    }
    const key = pair.slice(0, index).replace(/^body\./, '')
    values[key] = pair.slice(index + 1)
  }
  return values
}

function parameter(key: string, text: string) {
  return /^\d+$/.test(key)
    ? { type: 'text', text }
    : { type: 'text', parameter_name: key, text }
}

function byPosition(a: string, b: string): number {
  return Number(a) - Number(b) || a.localeCompare(b)
}

/** Cloud API `components` for the send call. */
export function buildComponents(
  variables: TemplateVariables,
  values: Record<string, string>,
): unknown[] {
  const components: unknown[] = []
  if (variables.header.length > 0) {
    components.push({
      type: 'header',
      parameters: [...variables.header]
        .sort(byPosition)
        .map((key) => parameter(key, values[`header.${key}`] ?? '')),
    })
  }
  if (variables.body.length > 0) {
    components.push({
      type: 'body',
      parameters: [...variables.body]
        .sort(byPosition)
        .map((key) => parameter(key, values[key] ?? '')),
    })
  }
  return components
}

/** Digits with the country code; `+55 (11) 99999-0000` is accepted. */
export function normalizePhone(input: string): string {
  const digits = input.replace(/[\s().+-]/g, '')
  if (!/^\d{8,15}$/.test(digits)) {
    throw usageError(
      `Número inválido: ${input}`,
      'Use o número com DDI e DDD, ex.: --to 5511999990000.',
    )
  }
  return digits
}

/* ------------------------------------------------------------------ */
/* steel zap templates                                                  */
/* ------------------------------------------------------------------ */

export interface TemplatesOptions extends PageOptions {
  status?: string
  connection?: string
}

export async function templates(ctx: Context, options: TemplatesOptions) {
  const status = parseEnum(
    options.status ? [options.status] : undefined,
    TEMPLATE_STATUSES,
    '--status',
  )?.[0]
  const target = await ctx.authTarget()
  const zap = ctx.client(target, target.token).whatsapp
  const page = await fetchPages(target, options, (query) =>
    zap.templates({
      ...query,
      ...(status ? { status } : {}),
      ...(options.connection ? { connectionId: options.connection } : {}),
    }),
  )
  printPage(ctx, page, {
    command: 'steel zap templates',
    empty:
      status && status !== 'APPROVED'
        ? 'Nenhum template com esse status.'
        : 'Nenhum template aprovado. Veja todos com --status todos.',
    table: (items) => (
      <Table
        columns={[
          { key: 'name', label: 'Nome' },
          { key: 'language', label: 'Idioma' },
          { key: 'category', label: 'Categoria' },
          { key: 'status', label: 'Status' },
          { key: 'quality', label: 'Qualidade' },
          { key: 'variables', label: 'Variáveis' },
        ]}
        rows={items.map((template) => ({
          name: template.name,
          language: template.language,
          category: template.category,
          status: label(TEMPLATE_STATUS_LABELS, template.status),
          quality: label(QUALITY_LABELS, template.quality),
          variables:
            variableKeys(templateVariables(template)).join(', ') || '—',
        }))}
      />
    ),
  })
}

/* ------------------------------------------------------------------ */
/* steel zap send                                                       */
/* ------------------------------------------------------------------ */

export interface SendOptions {
  template?: string
  to?: string
  contact?: string
  conversation?: string
  connection?: string
  language?: string
  var?: string[]
  yes?: boolean
}

function templateLabel(template: WhatsAppTemplate): string {
  return `${template.name} (${template.language})`
}

async function pickTemplate(
  ctx: Context,
  approved: WhatsAppTemplate[],
  options: SendOptions,
): Promise<WhatsAppTemplate> {
  const name = await required(
    ctx,
    options.template,
    '--template',
    () =>
      ctx.prompt.select(
        'Template',
        [...new Set(approved.map((template) => template.name))].map(
          (value) => ({ value, label: value }),
        ),
      ),
    'Veja os templates aprovados com `steel zap templates`.',
  )
  const candidates = approved.filter(
    (template) =>
      template.name === name &&
      (!options.language || template.language === options.language) &&
      (!options.connection || template.connectionId === options.connection),
  )
  const [first, ...rest] = candidates
  if (!first) {
    throw usageError(
      `Template aprovado não encontrado: ${name}${options.language ? ` (${options.language})` : ''}.`,
      'Veja os templates aprovados com `steel zap templates`.',
    )
  }
  if (rest.length === 0) return first
  if (!ctx.interactive) {
    throw usageError(
      `Há mais de um template “${name}” (idiomas ou conexões diferentes).`,
      'Escolha com --language <idioma> e/ou --connection <id>.',
    )
  }
  const id = await ctx.prompt.select(
    'Qual versão do template?',
    candidates.map((template) => ({
      value: template.id,
      label: templateLabel(template),
      hint: `conexão ${template.connectionId}`,
    })),
  )
  return candidates.find((template) => template.id === id) ?? first
}

export async function send(ctx: Context, options: SendOptions) {
  const values = parseVars(options.var)
  if (options.contact && options.conversation) {
    throw usageError('Use --contact ou --conversation, não os dois.')
  }
  const target = await ctx.authTarget()
  const zap = ctx.client(target, target.token).whatsapp
  const approved = (
    await fetchAll(target, (query) =>
      zap.templates({ ...query, status: 'APPROVED' }),
    )
  ).items
  const template = await pickTemplate(ctx, approved, options)

  const destination =
    options.conversation || options.contact
      ? undefined
      : normalizePhone(
          await required(
            ctx,
            options.to,
            '--to',
            () =>
              ctx.prompt.text('Número de destino (com DDI e DDD)', {
                required: true,
              }),
            'Use --to 5511999990000 (ou --contact/--conversation).',
          ),
        )

  const variables = templateVariables(template)
  const keys = variableKeys(variables)
  const unknown = Object.keys(values).filter((key) => !keys.includes(key))
  if (unknown.length > 0) {
    throw usageError(
      `O template ${template.name} não tem ${unknown.length === 1 ? 'a variável' : 'as variáveis'} ${unknown.join(', ')}.`,
      keys.length > 0
        ? `Variáveis do template: ${keys.join(', ')}.`
        : 'Este template não tem variáveis.',
    )
  }
  for (const key of keys) {
    if (values[key] !== undefined) continue
    values[key] = await required(
      ctx,
      undefined as string | undefined,
      `--var ${key}=<valor>`,
      () => ctx.prompt.text(`Valor de {{${key}}}`, { required: true }),
      `Variáveis do template: ${keys.join(', ')}.`,
    )
  }

  const components = buildComponents(variables, values)
  const body: WhatsAppTemplateSend = {
    templateName: template.name,
    language: template.language,
    ...(components.length > 0 ? { components } : {}),
    ...(options.conversation
      ? { conversationId: options.conversation }
      : { connectionId: template.connectionId }),
    ...(options.contact ? { contactId: options.contact } : {}),
    ...(destination ? { to: destination } : {}),
  }
  const who = destination
    ? `+${destination}`
    : options.contact
      ? `o contato ${options.contact}`
      : `a conversa ${options.conversation}`
  await confirmWrite(
    ctx,
    options.yes,
    `Enviar o template ${templateLabel(template)} para ${who}?`,
  )
  const message = unwrap(await zap.sendTemplate(body), target)
  if (ctx.json) {
    ctx.printJson(message)
    return
  }
  ctx.render(
    <>
      <Success>
        Template {template.name} enviado para {who}.
      </Success>
      <Hint>
        Mensagem {message.id} · conversa {message.conversationId} · status{' '}
        {message.status.toLowerCase()}
      </Hint>
    </>,
  )
}

/* ------------------------------------------------------------------ */
/* steel zap broadcast status                                           */
/* ------------------------------------------------------------------ */

/** Failed recipients listed on the terminal; `--json` has all of them. */
const FAILURES_SHOWN = 10

export async function broadcastStatus(ctx: Context, broadcastId: string) {
  const target = await ctx.authTarget()
  const broadcast = unwrap(
    await ctx.client(target, target.token).whatsapp.broadcast(broadcastId),
    target,
  )
  if (ctx.json) {
    ctx.printJson(broadcast)
    return
  }
  const processed =
    broadcast.sentCount + broadcast.failedCount + broadcast.skippedCount
  const failures = broadcast.recipients.filter(
    (recipient) => recipient.status === 'FAILED',
  )
  const statusColor =
    broadcast.status === 'FAILED'
      ? theme.danger
      : broadcast.status === 'DONE'
        ? theme.success
        : theme.brand
  ctx.render(
    <Box flexDirection='column'>
      <Text bold>{broadcast.name}</Text>
      <KeyValue
        rows={[
          [
            'Status',
            <Text key='s' color={statusColor}>
              {label(BROADCAST_STATUS_LABELS, broadcast.status)}
            </Text>,
          ],
          [
            'Progresso',
            `${progressBar(processed, broadcast.recipientCount)} (${processed}/${broadcast.recipientCount})`,
          ],
          ['Enviadas', String(broadcast.sentCount)],
          ['Falhas', String(broadcast.failedCount)],
          ['Ignoradas', String(broadcast.skippedCount)],
          [
            'Agendada',
            broadcast.scheduledAt
              ? formatDate(broadcast.scheduledAt, ctx.deps.timeZone)
              : '—',
          ],
          ['Criada em', formatDate(broadcast.createdAt, ctx.deps.timeZone)],
        ]}
      />
      {failures.length > 0 ? (
        <>
          <Text> </Text>
          <Table
            columns={[
              { key: 'contact', label: 'Contato' },
              { key: 'number', label: 'Número' },
              { key: 'error', label: 'Erro' },
            ]}
            rows={failures.slice(0, FAILURES_SHOWN).map((recipient) => ({
              contact: truncate(recipient.contactName ?? '—', 28),
              number: `+${recipient.contactWaId}`,
              error: truncate(recipient.errorMessage ?? '—', 50),
            }))}
          />
          {failures.length > FAILURES_SHOWN ? (
            <Hint>
              Mais {failures.length - FAILURES_SHOWN} falhas: rode com{' '}
              <Code>--json</Code> para ver todas.
            </Hint>
          ) : null}
        </>
      ) : null}
    </Box>,
  )
}
