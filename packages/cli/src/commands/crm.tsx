import type {
  CrmLeadCreate,
  CrmPipeline,
  CrmPipelineStage,
} from '@steel-so/sdk'
import { Box, Text } from 'ink'
import type { AuthTarget, Context } from '../context.js'
import { CliError, EXIT, usageError } from '../errors.js'
import {
  confirmWrite,
  fetchAll,
  fetchPages,
  type PageOptions,
  parseEnum,
  required,
  sameText,
  splitList,
  truncate,
  unwrap,
} from '../lib/domain.js'
import { formatDate } from '../lib/format.js'
import {
  Code,
  Hint,
  KeyValue,
  Success,
  Table,
  Warning,
} from '../ui/components.js'
import {
  formatDay,
  formatMoney,
  LEAD_STAGE_LABELS,
  LEAD_STAGES,
  label,
  STAGE_CATEGORY_LABELS,
} from '../ui/labels.js'
import { printPage } from '../ui/page.js'
import { theme } from '../ui/theme.js'

/** Server limits of `POST /api/v1/crm/leads/import`. */
export const IMPORT_MAX_ROWS = 5000
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024
/** Row errors listed on the terminal; `--json` has all of them. */
const IMPORT_ERRORS_SHOWN = 20

export interface LeadListOptions extends PageOptions {
  stage?: string
}

export async function leadList(ctx: Context, options: LeadListOptions) {
  const stage = parseEnum(
    options.stage ? [options.stage] : undefined,
    LEAD_STAGES,
    '--stage',
  )?.[0]
  const target = await ctx.authTarget()
  const crm = ctx.client(target, target.token).crm
  const page = await fetchPages(target, options, (query) =>
    crm.leads.list({ ...query, ...(stage ? { stage } : {}) }),
  )
  printPage(ctx, page, {
    command: 'steel crm lead list',
    empty: 'Nenhum lead encontrado.',
    table: (leads) => (
      <Table
        columns={[
          { key: 'name', label: 'Nome' },
          { key: 'email', label: 'E-mail' },
          { key: 'company', label: 'Empresa' },
          { key: 'stage', label: 'Etapa' },
          { key: 'score', label: 'Score' },
          { key: 'source', label: 'Origem' },
          { key: 'createdAt', label: 'Criado em' },
        ]}
        rows={leads.map((lead) => ({
          name: truncate(lead.name, 28),
          email: lead.emails[0] ?? '—',
          company: lead.company ? truncate(lead.company, 24) : '—',
          stage: label(LEAD_STAGE_LABELS, lead.stage),
          score: String(lead.score),
          source: lead.source ?? '—',
          createdAt: formatDate(lead.createdAt, ctx.deps.timeZone),
        }))}
      />
    ),
  })
}

/* ------------------------------------------------------------------ */

export interface LeadCreateOptions {
  name?: string
  email?: string[]
  phone?: string[]
  company?: string
  jobTitle?: string
  city?: string
  source?: string
  channel?: string
  yes?: boolean
}

/** Origin stamped on leads created from the terminal without `--source`. */
export const DEFAULT_LEAD_SOURCE = 'CLI'

export async function leadCreate(ctx: Context, options: LeadCreateOptions) {
  const target = await ctx.authTarget()
  const name = await required(ctx, options.name, '--name', () =>
    ctx.prompt.text('Nome do lead', { required: true }),
  )
  const emails = splitList(options.email)
  const phones = splitList(options.phone)
  const body: CrmLeadCreate = {
    name,
    source: options.source ?? DEFAULT_LEAD_SOURCE,
    ...(emails ? { emails } : {}),
    ...(phones ? { phones } : {}),
    ...(options.company ? { company: options.company } : {}),
    ...(options.jobTitle ? { jobTitle: options.jobTitle } : {}),
    ...(options.city ? { city: options.city } : {}),
    ...(options.channel ? { channel: options.channel } : {}),
  }
  await confirmWrite(ctx, options.yes, `Criar o lead “${name}”?`)
  const lead = unwrap(
    await ctx.client(target, target.token).crm.leads.create(body),
    target,
  )
  if (ctx.json) {
    ctx.printJson(lead)
    return
  }
  ctx.render(
    <Success>
      Lead {lead.name} criado em {label(LEAD_STAGE_LABELS, lead.stage)} (
      {lead.id}).
    </Success>,
  )
}

/* ------------------------------------------------------------------ */

export interface LeadImportOptions {
  source?: string
  yes?: boolean
}

/** Physical lines after the header; quoted multi-line cells overcount. */
export function countCsvRows(csv: string): number {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim() !== '')
  return Math.max(lines.length - 1, 0)
}

export async function leadImport(
  ctx: Context,
  file: string,
  options: LeadImportOptions,
): Promise<number> {
  const target = await ctx.authTarget()
  let csv: string
  try {
    csv =
      file === '-' ? await ctx.io.readStdin() : await ctx.deps.readFile(file)
  } catch (cause) {
    throw new CliError(`Não foi possível ler ${file}.`, {
      code: 'USAGE',
      exitCode: EXIT.USAGE,
      cause,
    })
  }
  const rows = countCsvRows(csv)
  if (rows === 0) {
    throw usageError(
      `${file} não tem linhas de dados.`,
      'A primeira linha é o cabeçalho (name, email, phone, company...).',
    )
  }
  if (Buffer.byteLength(csv) > IMPORT_MAX_BYTES) {
    throw usageError(
      `${file} passa de 5 MB.`,
      `Divida o arquivo: o limite é ${IMPORT_MAX_ROWS.toLocaleString('pt-BR')} linhas por importação.`,
    )
  }
  await confirmWrite(
    ctx,
    options.yes,
    `Importar ${rows.toLocaleString('pt-BR')} ${rows === 1 ? 'linha' : 'linhas'} de ${file} como leads?`,
  )
  const result = unwrap(
    await ctx
      .client(target, target.token)
      .crm.leads.import(csv, options.source ? { source: options.source } : {}),
    target,
  )
  const exitCode = result.errors.length > 0 ? EXIT.ERROR : EXIT.OK

  if (ctx.json) {
    ctx.printJson(result)
    return exitCode
  }
  const shown = result.errors.slice(0, IMPORT_ERRORS_SHOWN)
  ctx.render(
    <Box flexDirection='column'>
      {result.created > 0 ? (
        <Success>
          {result.created} de {result.total} leads importados.
        </Success>
      ) : (
        <Warning>Nenhum lead importado de {result.total} linhas.</Warning>
      )}
      <KeyValue
        rows={[
          ['Criados', String(result.created)],
          ['Ignorados', `${result.skipped} (duplicados ou vazios)`],
          ['Com erro', String(result.errors.length)],
        ]}
      />
      {shown.length > 0 ? (
        <>
          <Text> </Text>
          <Table
            columns={[
              { key: 'row', label: 'Linha' },
              { key: 'code', label: 'Código' },
              { key: 'message', label: 'Erro' },
            ]}
            rows={shown.map((error) => ({
              row: String(error.row),
              code: error.code,
              message: truncate(error.message, 60),
            }))}
          />
          {result.errors.length > shown.length ? (
            <Hint>
              Mais {result.errors.length - shown.length} erros: rode com{' '}
              <Code>--json</Code> para ver todos.
            </Hint>
          ) : null}
        </>
      ) : null}
    </Box>,
  )
  return exitCode
}

/* ------------------------------------------------------------------ */

function stageIndex(pipelines: CrmPipeline[]) {
  const stages = new Map<
    string,
    { stage: CrmPipelineStage; pipeline: CrmPipeline }
  >()
  for (const pipeline of pipelines) {
    for (const stage of pipeline.stages) {
      stages.set(stage.id, { stage, pipeline })
    }
  }
  return stages
}

async function loadPipelines(
  ctx: Context,
  target: AuthTarget,
): Promise<CrmPipeline[]> {
  const crm = ctx.client(target, target.token).crm
  return (await fetchAll(target, (query) => crm.pipelines(query))).items
}

export interface OpportunityListOptions extends PageOptions {
  pipeline?: string
  stage?: string
}

export async function opportunityList(
  ctx: Context,
  options: OpportunityListOptions,
) {
  const target = await ctx.authTarget()
  const crm = ctx.client(target, target.token).crm
  const page = await fetchPages(target, options, (query) =>
    crm.opportunities.list({
      ...query,
      ...(options.pipeline ? { pipelineId: options.pipeline } : {}),
      ...(options.stage ? { stageId: options.stage } : {}),
    }),
  )
  // Stage names only matter for people; scripts get the ids.
  const stages =
    ctx.json || page.items.length === 0
      ? new Map()
      : stageIndex(await loadPipelines(ctx, target))
  printPage(ctx, page, {
    command: 'steel crm opportunity list',
    empty: 'Nenhuma oportunidade encontrada.',
    table: (opportunities) => (
      <Table
        columns={[
          { key: 'name', label: 'Nome' },
          { key: 'amount', label: 'Valor' },
          { key: 'probability', label: 'Prob.' },
          { key: 'stage', label: 'Etapa' },
          { key: 'closeDate', label: 'Fechamento' },
          { key: 'id', label: 'Id' },
        ]}
        rows={opportunities.map((opportunity) => {
          const found = stages.get(opportunity.stageId)
          return {
            name: truncate(opportunity.name, 32),
            amount: formatMoney(opportunity.amount),
            probability:
              opportunity.probability === null
                ? '—'
                : `${opportunity.probability}%`,
            stage: found
              ? `${found.pipeline.name} › ${found.stage.name}`
              : opportunity.stageId,
            closeDate: opportunity.closeDate
              ? formatDay(opportunity.closeDate, ctx.deps.timeZone)
              : '—',
            id: opportunity.id,
          }
        })}
      />
    ),
  })
}

/* ------------------------------------------------------------------ */

export interface OpportunityMoveOptions {
  stage?: string
  pipeline?: string
  yes?: boolean
}

/** `--stage` by id, else by name (within `--pipeline` when given). */
export function resolveStage(
  pipelines: CrmPipeline[],
  stageInput: string,
  pipelineInput?: string,
): { stage: CrmPipelineStage; pipeline: CrmPipeline } {
  const scope = pipelineInput
    ? pipelines.filter(
        (pipeline) =>
          pipeline.id === pipelineInput ||
          sameText(pipeline.name, pipelineInput),
      )
    : pipelines
  if (pipelineInput && scope.length === 0) {
    throw usageError(
      `Funil não encontrado: ${pipelineInput}`,
      'Veja os funis com `steel crm pipelines`.',
    )
  }
  const index = stageIndex(scope)
  const byId = index.get(stageInput)
  if (byId) return byId
  const matches = [...index.values()].filter(({ stage }) =>
    sameText(stage.name, stageInput),
  )
  const [match, ...others] = matches
  if (!match) {
    throw usageError(
      `Etapa não encontrada: ${stageInput}`,
      'Veja as etapas com `steel crm pipelines`.',
    )
  }
  if (others.length > 0) {
    throw usageError(
      `A etapa “${stageInput}” existe em mais de um funil.`,
      'Diga qual com --pipeline <id ou nome>.',
    )
  }
  return match
}

export async function opportunityMove(
  ctx: Context,
  opportunityId: string,
  options: OpportunityMoveOptions,
) {
  const target = await ctx.authTarget()
  const pipelines = await loadPipelines(ctx, target)
  const stageInput = await required(
    ctx,
    options.stage,
    '--stage',
    () =>
      ctx.prompt.select(
        'Etapa de destino',
        pipelines.flatMap((pipeline) =>
          pipeline.stages.map((stage) => ({
            value: stage.id,
            label: `${pipeline.name} › ${stage.name}`,
            hint: `${stage.probability}%`,
          })),
        ),
      ),
    'Use --stage <id ou nome> (veja `steel crm pipelines`).',
  )
  const { stage, pipeline } = resolveStage(
    pipelines,
    stageInput,
    options.pipeline,
  )
  await confirmWrite(
    ctx,
    options.yes,
    `Mover a oportunidade ${opportunityId} para ${pipeline.name} › ${stage.name}?`,
  )
  const opportunity = unwrap(
    await ctx
      .client(target, target.token)
      .crm.opportunities.move(opportunityId, {
        stageId: stage.id,
        pipelineId: pipeline.id,
      }),
    target,
  )
  if (ctx.json) {
    ctx.printJson(opportunity)
    return
  }
  ctx.render(
    <Success>
      {opportunity.name} agora está em {pipeline.name} › {stage.name}.
    </Success>,
  )
}

/* ------------------------------------------------------------------ */

export async function pipelines(ctx: Context, options: PageOptions) {
  const target = await ctx.authTarget()
  const crm = ctx.client(target, target.token).crm
  const page = await fetchPages(target, options, (query) =>
    crm.pipelines(query),
  )
  printPage(ctx, page, {
    command: 'steel crm pipelines',
    empty: 'Nenhum funil configurado.',
    table: (items) => (
      <Box flexDirection='column'>
        {items.map((pipeline, index) => (
          <Box key={pipeline.id} flexDirection='column'>
            {index > 0 ? <Text> </Text> : null}
            <Text bold>
              {pipeline.name}
              {pipeline.isDefault ? ' (padrão)' : ''}{' '}
              <Text dimColor>{pipeline.id}</Text>
            </Text>
            {pipeline.stages.length === 0 ? (
              <Text color={theme.muted}>Funil sem etapas.</Text>
            ) : (
              <Table
                columns={[
                  { key: 'name', label: 'Etapa' },
                  { key: 'probability', label: 'Prob.' },
                  { key: 'category', label: 'Tipo' },
                  { key: 'id', label: 'Id' },
                ]}
                rows={[...pipeline.stages]
                  .sort((a, b) => a.position - b.position)
                  .map((stage) => ({
                    name: stage.name,
                    probability: `${stage.probability}%`,
                    category: label(STAGE_CATEGORY_LABELS, stage.category),
                    id: stage.id,
                  }))}
              />
            )}
          </Box>
        ))}
      </Box>
    ),
  })
}
