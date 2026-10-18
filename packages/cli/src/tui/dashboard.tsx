import { Box, Text, useApp, useInput, useWindowSize } from 'ink'
import { type ComponentType, useCallback, useState } from 'react'
import { moduleLabel, theme } from '../ui/theme.js'
import { CrmTab } from './crm-tab.js'
import type { DashboardSession } from './data.js'
import type { TabMode, TabProps } from './list-tab.js'
import { ServicedeskTab } from './servicedesk-tab.js'
import { WebhooksTab } from './webhooks-tab.js'
import { HelpOverlay } from './widgets.js'
import { ZapTab } from './zap-tab.js'

export interface TabDefinition {
  id: string
  label: string
  Component: ComponentType<TabProps>
}

export const TABS: TabDefinition[] = [
  { id: 'servicedesk', label: 'ServiceDesk', Component: ServicedeskTab },
  { id: 'crm', label: 'CRM', Component: CrmTab },
  { id: 'zap', label: 'Comunicação', Component: ZapTab },
  { id: 'webhooks', label: 'Webhooks', Component: WebhooksTab },
]

/** Header, tab bar and footer around the tab body. */
const CHROME_ROWS = 7

function Header({
  session,
  width,
}: {
  session: DashboardSession
  width: number
}) {
  const { me } = session
  return (
    <Box justifyContent='space-between' width={width}>
      <Text>
        <Text color={theme.brand} bold>
          ◆ Steel
        </Text>{' '}
        <Text bold>{me.workspace.name}</Text>{' '}
        <Text color={theme.muted}>({me.workspace.slug})</Text>
      </Text>
      <Text>
        {me.user.name}{' '}
        <Text color={theme.muted}>
          · {session.profileName}
          {width >= 100 ? ` · ${session.url}` : ''}
        </Text>
      </Text>
    </Box>
  )
}

function TabBar({ active }: { active: number }) {
  return (
    <Box columnGap={1}>
      {TABS.map((tab, i) =>
        i === active ? (
          <Text key={tab.id} color={theme.brand} bold>
            [{i + 1} {tab.label}]
          </Text>
        ) : (
          <Text key={tab.id} color={theme.muted}>
            {' '}
            {i + 1} {tab.label}{' '}
          </Text>
        ),
      )}
    </Box>
  )
}

const FOOTERS: Record<TabMode, string> = {
  list: '←/→ abas · ↑/↓ linhas · Enter abre · / filtra · r atualiza · ? ajuda · q sai',
  detail: 'Esc volta · ? ajuda · q sai',
  input: '',
}

/** `steel` with no arguments on a terminal: the full-screen dashboard. */
export function Dashboard({
  session,
  initialTab = 0,
}: {
  session: DashboardSession
  initialTab?: number
}) {
  const { exit } = useApp()
  const { columns, rows } = useWindowSize()
  const [tab, setTab] = useState(initialTab)
  const [mode, setMode] = useState<TabMode>('list')
  const [help, setHelp] = useState(false)
  const onMode = useCallback((next: TabMode) => setMode(next), [])

  useInput((input, key) => {
    if (help) {
      setHelp(false)
      return
    }
    if (mode === 'input') return
    if (input === '?') return setHelp(true)
    if (input === 'q') return exit()
    if (mode === 'detail') return
    if (key.escape) return exit()
    if (key.rightArrow || (key.tab && !key.shift)) {
      return setTab((i) => (i + 1) % TABS.length)
    }
    if (key.leftArrow || (key.tab && key.shift)) {
      return setTab((i) => (i + TABS.length - 1) % TABS.length)
    }
    const number = Number(input)
    if (Number.isInteger(number) && number >= 1 && number <= TABS.length) {
      setTab(number - 1)
    }
  })

  const width = Math.max(40, columns - 2)
  const bodyHeight = Math.max(5, rows - CHROME_ROWS)
  const footer = FOOTERS[mode]
  return (
    <Box flexDirection='column' paddingX={1} width={columns}>
      <Header session={session} width={width} />
      <Text color={theme.muted}>{'─'.repeat(width)}</Text>
      <TabBar active={tab} />
      <Box
        flexDirection='column'
        marginTop={1}
        height={bodyHeight}
        overflow='hidden'
      >
        {/* Natural height, clipped at the bottom instead of squeezed. */}
        <Box flexDirection='column' flexShrink={0}>
          {help ? <HelpOverlay /> : null}
          {TABS.map(({ id, Component }, i) => (
            <Component
              key={id}
              active={i === tab && !help}
              session={session}
              height={bodyHeight}
              width={width}
              onMode={onMode}
            />
          ))}
        </Box>
      </Box>
      <Text color={theme.muted}>
        {footer || ' '}
        {mode === 'list' && session.me.modules.length < 3 ? (
          <Text>
            {' '}
            · token com{' '}
            {session.me.modules.map(moduleLabel).join(', ') || 'nenhum módulo'}
          </Text>
        ) : null}
      </Text>
    </Box>
  )
}
