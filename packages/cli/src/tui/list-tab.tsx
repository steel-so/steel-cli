import { Box, Text, useInput } from 'ink'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import type { CliError } from '../errors.js'
import { theme } from '../ui/theme.js'
import { type DashboardSession, matchesFilter, toCliError } from './data.js'
import {
  Empty,
  ErrorState,
  type ListColumn,
  type ListRow,
  Loading,
  RowList,
  TextInput,
} from './widgets.js'

/**
 * What a tab tells the dashboard about the keyboard: `list` lets every
 * global key through, `detail` keeps q and ?, `input` keeps none.
 */
export type TabMode = 'list' | 'detail' | 'input'

export interface TabProps {
  /** The tab is on screen and may read keys. */
  active: boolean
  session: DashboardSession
  /** Rows available for the tab body. */
  height: number
  width: number
  onMode(mode: TabMode): void
}

export interface DetailProps<D, T> {
  item: T
  data: D
  session: DashboardSession
  active: boolean
  width: number
  height: number
  onBack(): void
  /** Reloads the tab after a write. */
  onChanged(): void
  onMode(mode: TabMode): void
}

export interface ListTabConfig<D, T> {
  loadingLabel: string
  load(session: DashboardSession): Promise<D>
  items(data: D): T[]
  id(item: T): string
  columns: ListColumn[]
  row(item: T, data: D, session: DashboardSession): ListRow
  /** Text the `/` filter searches. */
  text(item: T): string
  empty: string
  /** Lines above the table (counts, totals). */
  summary?(data: D, items: T[]): ReactNode
  /** Rows the summary takes, its bottom margin included (default 2). */
  summaryHeight?: number
  /** Extra list keys; returns true when it handled the key. */
  keys?(input: string, data: D): boolean
  Detail(props: DetailProps<D, T>): ReactNode
}

type State<D> =
  | { status: 'loading'; data?: D }
  | { status: 'ready'; data: D }
  | { status: 'error'; error: CliError; data?: D }

/** A lazily loaded, filterable list with a detail view. */
export function ListTab<D, T>({
  config,
  active,
  session,
  height,
  width,
  onMode,
}: TabProps & { config: ListTabConfig<D, T> }) {
  const [state, setState] = useState<State<D> | undefined>(undefined)
  const [selected, setSelected] = useState(0)
  const [filter, setFilter] = useState('')
  const [filtering, setFiltering] = useState(false)
  const [detail, setDetail] = useState<T | undefined>(undefined)
  const [detailMode, setDetailMode] = useState<TabMode>('detail')
  const generation = useRef(0)

  const reload = useCallback(() => {
    const current = ++generation.current
    setState((previous) => ({ status: 'loading', data: previous?.data }))
    config.load(session).then(
      (data) => {
        if (current === generation.current) setState({ status: 'ready', data })
      },
      (error: unknown) => {
        if (current !== generation.current) return
        setState((previous) => ({
          status: 'error',
          error: toCliError(error),
          data: previous?.data,
        }))
      },
    )
  }, [config, session])

  // Loads on first view, not at start-up: one tab's error never blocks another.
  useEffect(() => {
    if (active && state === undefined) reload()
  }, [active, state, reload])

  const all = state?.data === undefined ? [] : config.items(state.data)
  const items = filter
    ? all.filter((item) => matchesFilter(config.text(item), filter))
    : all
  const index = Math.max(0, Math.min(selected, items.length - 1))
  // The open item, refreshed after a reload (it may have left the list).
  const open =
    detail === undefined
      ? undefined
      : (all.find((item) => config.id(item) === config.id(detail)) ?? detail)

  const mode: TabMode = filtering ? 'input' : open ? detailMode : 'list'
  useEffect(() => {
    if (active) onMode(mode)
  }, [active, mode, onMode])

  useInput(
    (input, key) => {
      const last = Math.max(0, items.length - 1)
      if (key.upArrow || input === 'k') {
        return setSelected((i) => Math.max(0, Math.min(i, last) - 1))
      }
      if (key.downArrow || input === 'j') {
        return setSelected((i) => Math.min(last, i + 1))
      }
      if (key.pageUp) return setSelected(Math.max(0, index - height))
      if (key.pageDown) {
        return setSelected(Math.min(items.length - 1, index + height))
      }
      if (key.home) return setSelected(0)
      if (key.end) return setSelected(Math.max(0, items.length - 1))
      if (input === 'r') return reload()
      if (input === '/') return setFiltering(true)
      if (key.return) {
        const item = items[index]
        if (item !== undefined) {
          setDetailMode('detail')
          setDetail(item)
        }
        return
      }
      if (state?.data !== undefined) config.keys?.(input, state.data)
    },
    { isActive: active && mode === 'list' },
  )

  if (!active) return null

  if (open !== undefined && state?.data !== undefined) {
    const { Detail } = config
    return (
      <Detail
        item={open}
        data={state.data}
        session={session}
        active={active}
        width={width}
        height={height}
        onBack={() => {
          setDetail(undefined)
          setDetailMode('detail')
        }}
        onChanged={reload}
        onMode={setDetailMode}
      />
    )
  }

  const summary =
    state?.data !== undefined && config.summary
      ? config.summary(state.data, items)
      : null
  const footer = filtering ? (
    <TextInput
      label='Filtrar:'
      initial={filter}
      placeholder='texto, código, nome…'
      footer='Enter aplica · Esc limpa'
      onChange={(value) => {
        setFilter(value)
        setSelected(0)
      }}
      onSubmit={(value) => {
        setFilter(value.trim())
        setFiltering(false)
      }}
      onCancel={() => {
        setFilter('')
        setFiltering(false)
      }}
    />
  ) : filter ? (
    <Text color={theme.muted}>
      Filtro: <Text color={theme.brandSoft}>{filter}</Text> · / muda · Esc no
      campo limpa
    </Text>
  ) : null

  const reserved =
    (summary ? (config.summaryHeight ?? 2) : 0) + (footer ? 3 : 0)
  return (
    <Box flexDirection='column'>
      {state === undefined ||
      (state.status === 'loading' && state.data === undefined) ? (
        <Loading label={config.loadingLabel} />
      ) : state.status === 'error' ? (
        <ErrorState message={state.error.message} hint={state.error.hint} />
      ) : (
        <>
          {summary ? <Box marginBottom={1}>{summary}</Box> : null}
          {items.length === 0 ? (
            <Empty>
              {filter ? `Nada encontrado para “${filter}”.` : config.empty}
            </Empty>
          ) : (
            <RowList
              columns={config.columns}
              rows={items.map((item) =>
                config.row(item, state.data as D, session),
              )}
              selected={index}
              height={Math.max(3, height - reserved)}
              width={width}
            />
          )}
          {state.status === 'loading' ? <Loading label='Atualizando…' /> : null}
        </>
      )}
      {footer ? <Box marginTop={1}>{footer}</Box> : null}
    </Box>
  )
}
