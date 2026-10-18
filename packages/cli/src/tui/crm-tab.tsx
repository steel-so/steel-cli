import type { CrmOpportunity } from '@steel-so/sdk'
import { Box, Text, useInput } from 'ink'
import { useEffect, useMemo, useState } from 'react'
import { KeyValue } from '../ui/components.js'
import { formatDay, formatMoney } from '../ui/labels.js'
import { theme } from '../ui/theme.js'
import { type CrmData, check, loadCrm, type PipelineBoard } from './data.js'
import { capturesKeys, FlowView, useFlow } from './flow.js'
import {
  type DetailProps,
  ListTab,
  type ListTabConfig,
  type TabProps,
} from './list-tab.js'

function boardAt(data: CrmData, index: number): PipelineBoard | undefined {
  return data.boards.length === 0
    ? undefined
    : data.boards[index % data.boards.length]
}

function stageName(board: PipelineBoard | undefined, stageId: string) {
  return (
    board?.groups.find((group) => group.stage.id === stageId)?.stage.name ??
    stageId
  )
}

function OpportunityDetail({
  item: opportunity,
  data,
  session,
  active,
  onBack,
  onChanged,
  onMode,
}: DetailProps<CrmData, CrmOpportunity>) {
  const { step, setStep, cancel, confirmThenRun } = useFlow(onChanged)
  const busy = capturesKeys(step)
  const board = data.boards.find(
    (item) => item.pipeline.id === opportunity.pipelineId,
  )

  useEffect(() => {
    onMode(busy ? 'input' : 'detail')
  }, [busy, onMode])

  const move = () => {
    const stages = (board?.groups ?? [])
      .map((group) => group.stage)
      .filter((stage) => stage.id !== opportunity.stageId)
    if (!board || stages.length === 0) {
      setStep({
        kind: 'result',
        tone: 'error',
        text: 'Não há outra etapa neste funil.',
        hint: 'Veja os funis com `steel crm pipelines`.',
      })
      return
    }
    setStep({
      kind: 'select',
      label: `Mover ${opportunity.name} para`,
      choices: stages.map((stage) => ({
        value: stage.id,
        label: stage.name,
        hint: `${stage.probability}%`,
      })),
      onSubmit: (stageId) => {
        const stage = stages.find((item) => item.id === stageId)
        const target = `${board.pipeline.name} › ${stage?.name ?? stageId}`
        confirmThenRun(
          `Mover a oportunidade ${opportunity.name} para ${target}?`,
          'Movendo…',
          async () => {
            const moved = check(
              await session.client.crm.opportunities.move(opportunity.id, {
                stageId,
                pipelineId: board.pipeline.id,
              }),
              session.url,
            )
            return `${moved.name} agora está em ${target}.`
          },
        )
      },
    })
  }

  useInput(
    (input, key) => {
      if (key.escape) return onBack()
      if (input === 'm') return move()
    },
    { isActive: active && !busy },
  )

  if (step.kind !== 'idle') {
    return (
      <Box flexDirection='column'>
        <Text bold color={theme.brand}>
          {opportunity.name}
        </Text>
        <Text color={theme.muted}>
          {board?.pipeline.name ?? opportunity.pipelineId} ›{' '}
          {stageName(board, opportunity.stageId)} ·{' '}
          {formatMoney(opportunity.amount)}
        </Text>
        <Box marginTop={1} flexDirection='column'>
          <FlowView step={step} onCancel={cancel} />
          {busy ? null : (
            <Text color={theme.muted}>m move de etapa · Esc volta</Text>
          )}
        </Box>
      </Box>
    )
  }
  return (
    <Box flexDirection='column'>
      <Text bold color={theme.brand}>
        {opportunity.name}
      </Text>
      <Text> </Text>
      <KeyValue
        rows={[
          ['Funil', board?.pipeline.name ?? opportunity.pipelineId],
          ['Etapa', stageName(board, opportunity.stageId)],
          ['Valor', formatMoney(opportunity.amount)],
          [
            'Probabilidade',
            opportunity.probability === null
              ? '—'
              : `${opportunity.probability}%`,
          ],
          [
            'Fechamento',
            opportunity.closeDate
              ? formatDay(opportunity.closeDate, session.timeZone)
              : '—',
          ],
          ['Id', opportunity.id],
        ]}
      />
      <Box marginTop={1}>
        <Text color={theme.muted}>m move de etapa · Esc volta</Text>
      </Box>
    </Box>
  )
}

export function crmConfig(
  boardIndex: number,
  nextBoard: () => void,
): ListTabConfig<CrmData, CrmOpportunity> {
  return {
    loadingLabel: 'Carregando as oportunidades…',
    load: loadCrm,
    items: (data) =>
      boardAt(data, boardIndex)?.groups.flatMap(
        (group) => group.opportunities,
      ) ?? [],
    id: (opportunity) => opportunity.id,
    columns: [
      { key: 'stage', label: 'Etapa' },
      { key: 'name', label: 'Oportunidade', flex: true },
      { key: 'amount', label: 'Valor' },
      { key: 'probability', label: 'Prob.' },
      { key: 'closeDate', label: 'Fechamento' },
    ],
    row: (opportunity, data, session) => ({
      id: opportunity.id,
      cells: {
        stage: stageName(boardAt(data, boardIndex), opportunity.stageId),
        name: opportunity.name,
        amount: formatMoney(opportunity.amount),
        probability:
          opportunity.probability === null
            ? '—'
            : `${opportunity.probability}%`,
        closeDate: opportunity.closeDate
          ? formatDay(opportunity.closeDate, session.timeZone)
          : '—',
      },
    }),
    text: (opportunity) => opportunity.name,
    empty: 'Nenhuma oportunidade neste funil.',
    summaryHeight: 4,
    summary: (data) => {
      const board = boardAt(data, boardIndex)
      if (!board)
        return <Text color={theme.muted}>Nenhum funil configurado.</Text>
      return (
        <Box flexDirection='column'>
          <Text>
            <Text bold>{board.pipeline.name}</Text>
            {data.boards.length > 1 ? (
              <Text color={theme.muted}>
                {' '}
                ({(boardIndex % data.boards.length) + 1}/{data.boards.length} ·
                p troca o funil)
              </Text>
            ) : null}
          </Text>
          <Box flexWrap='wrap' columnGap={2}>
            {board.groups.map((group) => (
              <Text key={group.stage.id}>
                <Text color={theme.brandSoft}>{group.stage.name}</Text>{' '}
                {group.opportunities.length}
                <Text color={theme.muted}> · {formatMoney(group.total)}</Text>
              </Text>
            ))}
          </Box>
        </Box>
      )
    },
    keys: (input) => {
      if (input !== 'p') return false
      nextBoard()
      return true
    },
    Detail: OpportunityDetail,
  }
}

export function CrmTab(props: TabProps) {
  const [boardIndex, setBoardIndex] = useState(0)
  const config = useMemo(
    () => crmConfig(boardIndex, () => setBoardIndex((i) => i + 1)),
    [boardIndex],
  )
  return <ListTab {...props} config={config} />
}
