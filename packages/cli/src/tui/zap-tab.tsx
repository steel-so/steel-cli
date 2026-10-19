import type { WhatsAppConversation } from '@steel-so/sdk'
import { Box, Text, useInput } from 'ink'
import { useEffect } from 'react'
import { contactLabel, waitingSince } from '../commands/zap.js'
import { formatDate } from '../lib/format.js'
import { Code, Hint, KeyValue } from '../ui/components.js'
import { CONVERSATION_STATUS_LABELS, label } from '../ui/labels.js'
import { theme } from '../ui/theme.js'
import { loadZap, type ZapData } from './data.js'
import {
  type DetailProps,
  ListTab,
  type ListTabConfig,
  type TabProps,
} from './list-tab.js'

function statusText(conversation: WhatsAppConversation): string {
  return conversation.aiActive
    ? 'Com a IA'
    : label(CONVERSATION_STATUS_LABELS, conversation.status)
}

function ConversationDetail({
  item: conversation,
  session,
  active,
  onBack,
  onMode,
}: DetailProps<ZapData, WhatsAppConversation>) {
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
        {contactLabel(conversation)}
      </Text>
      <Text> </Text>
      <KeyValue
        rows={[
          ['Número', `+${conversation.contactWaId}`],
          ['Fila', conversation.team?.name ?? 'Geral'],
          ['Status', statusText(conversation)],
          ['Não lidas', String(conversation.unreadCount)],
          [
            'Última mensagem',
            formatDate(waitingSince(conversation), session.timeZone),
          ],
          ['Conexão', conversation.connectionId],
        ]}
      />
      <Box marginTop={1}>
        <Text>{conversation.lastMessagePreview?.trim() || '(sem prévia)'}</Text>
      </Box>
      <Box marginTop={1} flexDirection='column'>
        {conversation.aiActive ? (
          <Hint>
            A IA está atendendo: envios manuais ficam bloqueados até removê-la
            no Steel.
          </Hint>
        ) : (
          <Hint>
            Responda com{' '}
            <Code>
              steel zap send --conversation {conversation.id} --template{' '}
              {'<nome>'}
            </Code>
            .
          </Hint>
        )}
        <Text color={theme.muted}>Esc volta</Text>
      </Box>
    </Box>
  )
}

export const zapConfig: ListTabConfig<ZapData, WhatsAppConversation> = {
  loadingLabel: 'Carregando a fila de atendimento…',
  load: loadZap,
  items: (data) => data.conversations,
  id: (conversation) => conversation.id,
  columns: [
    { key: 'contact', label: 'Contato', flex: true },
    { key: 'team', label: 'Fila' },
    { key: 'status', label: 'Status' },
    { key: 'since', label: 'Última msg.' },
    { key: 'unread', label: 'Não lidas' },
  ],
  row: (conversation, _data, session) => ({
    id: conversation.id,
    color: conversation.aiActive ? theme.muted : undefined,
    cells: {
      contact: contactLabel(conversation),
      team: conversation.team?.name ?? 'Geral',
      status: statusText(conversation),
      since: formatDate(waitingSince(conversation), session.timeZone),
      unread: String(conversation.unreadCount),
    },
  }),
  text: (conversation) =>
    [
      conversation.contactName ?? '',
      conversation.contactWaId,
      conversation.team?.name ?? 'Geral',
      conversation.lastMessagePreview ?? '',
    ].join(' '),
  empty: 'Nenhuma conversa aguardando atendimento. Fila limpa!',
  summary: (data) => (
    <Text>
      <Text bold>Aguardando atendimento</Text>{' '}
      <Text color={theme.muted}>
        {data.conversations.length === 1
          ? '1 conversa'
          : `${data.conversations.length} conversas`}
        {data.withAi > 0 ? ` · ${data.withAi} com a IA` : ''}
      </Text>
    </Text>
  ),
  Detail: ConversationDetail,
}

export function ZapTab(props: TabProps) {
  return <ListTab {...props} config={zapConfig} />
}
