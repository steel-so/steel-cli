import type { WhatsAppTemplate } from '@steel-so/sdk'
import { Box, Text, useInput } from 'ink'
import { useEffect } from 'react'
import { Code, Hint, KeyValue } from '../ui/components.js'
import { label, QUALITY_LABELS } from '../ui/labels.js'
import { theme } from '../ui/theme.js'
import { loadZap, templateBody, type ZapData } from './data.js'
import {
  type DetailProps,
  ListTab,
  type ListTabConfig,
  type TabProps,
} from './list-tab.js'

const QUALITY_COLORS: Record<string, string> = {
  YELLOW: theme.warning,
  RED: theme.danger,
}

function TemplateDetail({
  item: template,
  active,
  onBack,
  onMode,
}: DetailProps<ZapData, WhatsAppTemplate>) {
  useEffect(() => {
    onMode('detail')
  }, [onMode])
  useInput(
    (_input, key) => {
      if (key.escape) onBack()
    },
    { isActive: active },
  )
  return (
    <Box flexDirection='column'>
      <Text bold color={theme.brand}>
        {template.name}
      </Text>
      <Text> </Text>
      <KeyValue
        rows={[
          ['Idioma', template.language],
          ['Categoria', template.category],
          ['Qualidade', label(QUALITY_LABELS, template.quality)],
          ['Conexão', template.connectionId],
        ]}
      />
      <Box marginTop={1}>
        <Text>{templateBody(template) || '(sem texto)'}</Text>
      </Box>
      <Box marginTop={1} flexDirection='column'>
        <Hint>
          Envie com{' '}
          <Code>
            steel zap send --template {template.name} --to {'<número>'}
          </Code>
          .
        </Hint>
        <Text color={theme.muted}>Esc volta</Text>
      </Box>
    </Box>
  )
}

export const zapConfig: ListTabConfig<ZapData, WhatsAppTemplate> = {
  loadingLabel: 'Carregando a Comunicação…',
  load: loadZap,
  items: (data) => data.templates,
  id: (template) => template.id,
  columns: [
    { key: 'name', label: 'Template', flex: true },
    { key: 'language', label: 'Idioma' },
    { key: 'category', label: 'Categoria' },
    { key: 'quality', label: 'Qualidade' },
  ],
  row: (template) => ({
    id: template.id,
    color: QUALITY_COLORS[template.quality],
    cells: {
      name: template.name,
      language: template.language,
      category: template.category,
      quality: label(QUALITY_LABELS, template.quality),
    },
  }),
  text: (template) =>
    `${template.name} ${template.category} ${templateBody(template)}`,
  empty: 'Nenhum template aprovado nas conexões do workspace.',
  // The API v1 has no conversation list yet: say so instead of faking it.
  summaryHeight: 4,
  summary: () => (
    <Box flexDirection='column'>
      <Text>
        <Text bold>Templates aprovados</Text>
      </Text>
      <Text color={theme.muted}>
        As conversas aguardando atendimento ainda não estão na API v1; abra o
        Steel no navegador para vê-las.
      </Text>
    </Box>
  ),
  Detail: TemplateDetail,
}

export function ZapTab(props: TabProps) {
  return <ListTab {...props} config={zapConfig} />
}
