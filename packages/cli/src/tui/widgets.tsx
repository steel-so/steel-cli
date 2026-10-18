import { Box, Text, useInput } from 'ink'
import Spinner from 'ink-spinner'
import { type ReactNode, useRef, useState } from 'react'
import { truncate } from '../lib/domain.js'
import { ErrorMessage, Hint } from '../ui/components.js'
import { symbols, theme } from '../ui/theme.js'

/* ------------------------------------------------------------------ */
/* Row list                                                            */
/* ------------------------------------------------------------------ */

export interface ListColumn {
  key: string
  label: string
  /** The column that gives up width when the terminal is narrow. */
  flex?: boolean
}

export interface ListRow {
  id: string
  cells: Record<string, string>
  color?: string
}

const GAP = 2
/** `› ` in front of the selected row (also readable without colors). */
const MARKER = 2
const MIN_FLEX = 8

/** Column widths that fit `width`, shrinking the flex column first. */
export function fitColumns(
  columns: ListColumn[],
  rows: ListRow[],
  width: number,
): number[] {
  const widths = columns.map((column) =>
    Math.max(
      column.label.length,
      ...rows.map((row) => (row.cells[column.key] ?? '').length),
    ),
  )
  const total =
    widths.reduce((sum, value) => sum + value, 0) +
    GAP * (columns.length - 1) +
    MARKER
  let excess = total - width
  if (excess <= 0) return widths
  const order = [
    ...columns.flatMap((column, i) => (column.flex ? [i] : [])),
    ...columns.flatMap((column, i) => (column.flex ? [] : [i])).reverse(),
  ]
  for (const index of order) {
    const current = widths[index] ?? 0
    const floor = Math.min(current, MIN_FLEX)
    const cut = Math.min(excess, current - floor)
    widths[index] = current - cut
    excess -= cut
    if (excess <= 0) break
  }
  return widths
}

/** First row shown so that `selected` stays on screen. */
export function scrollOffset(
  selected: number,
  count: number,
  height: number,
): number {
  if (count <= height) return 0
  const centered = selected - Math.floor(height / 2)
  return Math.max(0, Math.min(centered, count - height))
}

function cell(text: string, width: number): string {
  const flat = text.length > width ? truncate(text, width) : text
  return flat.padEnd(width)
}

export function RowList({
  columns,
  rows,
  selected,
  height,
  width,
}: {
  columns: ListColumn[]
  rows: ListRow[]
  selected: number
  height: number
  width: number
}) {
  const widths = fitColumns(columns, rows, width)
  // Header and rule, plus the "1–n de m" line when the list scrolls.
  const visible = Math.max(1, height - (rows.length > height - 2 ? 3 : 2))
  const offset = scrollOffset(selected, rows.length, visible)
  const line = (cells: string[]) =>
    cells
      .map((text, i) => cell(text, widths[i] ?? 0))
      .join(' '.repeat(GAP))
      .trimEnd()
  const shown = rows.slice(offset, offset + visible)
  return (
    <Box flexDirection='column'>
      <Text color={theme.brand} bold>
        {'  '}
        {line(columns.map((column) => column.label.toUpperCase()))}
      </Text>
      <Text color={theme.muted}>
        {'  '}
        {line(widths.map((value) => '─'.repeat(value)))}
      </Text>
      {shown.map((row, i) => {
        const isSelected = offset + i === selected
        return (
          <Text
            key={row.id}
            color={isSelected ? theme.brandSoft : row.color}
            bold={isSelected}
          >
            {isSelected ? `${symbols.info} ` : '  '}
            {line(columns.map((column) => row.cells[column.key] ?? ''))}
          </Text>
        )
      })}
      {rows.length > visible ? (
        <Text color={theme.muted}>
          {'  '}
          {offset + 1}–{offset + shown.length} de {rows.length}
        </Text>
      ) : null}
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */

export function Loading({ label }: { label: string }) {
  return (
    <Text>
      <Text color={theme.brand}>
        <Spinner type='dots' />
      </Text>{' '}
      {label}
    </Text>
  )
}

export function ErrorState({
  message,
  hint,
}: {
  message: string
  hint?: string
}) {
  return (
    <Box flexDirection='column'>
      <ErrorMessage message={message} hint={hint} />
      <Hint>
        <Text>r tenta de novo.</Text>
      </Hint>
    </Box>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <Text color={theme.muted}>{children}</Text>
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export function TextInput({
  label,
  initial = '',
  placeholder,
  footer,
  onSubmit,
  onCancel,
  onChange,
  extra,
}: {
  label: string
  initial?: string
  placeholder?: string
  footer?: ReactNode
  onSubmit(value: string): void
  onCancel(): void
  onChange?(value: string): void
  /** Keys the caller handles itself (e.g. Tab toggles visibility). */
  extra?: (input: string, key: { tab: boolean }) => boolean
}) {
  const [value, setValue] = useState(initial)
  // Keys can arrive faster than renders (a paste, a fast typist).
  const latest = useRef(initial)
  const update = (next: string) => {
    latest.current = next
    setValue(next)
    onChange?.(next)
  }
  useInput((input, key) => {
    const current = latest.current
    if (extra?.(input, key)) return
    if (key.escape) return onCancel()
    if (key.return) return onSubmit(current)
    if (key.backspace || key.delete) return update(current.slice(0, -1))
    if (key.ctrl && input === 'u') return update('')
    if (key.ctrl || key.meta || key.tab) return
    if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return
    if (input) update(current + input.replace(/\r?\n/g, ' '))
  })
  return (
    <Box flexDirection='column'>
      <Text>
        <Text color={theme.brand} bold>
          {label}
        </Text>{' '}
        {value ? (
          <Text>{value}</Text>
        ) : (
          <Text color={theme.muted}>{placeholder ?? ''}</Text>
        )}
        <Text color={theme.brandSoft}>▏</Text>
      </Text>
      <Text color={theme.muted}>
        {footer ?? 'Enter confirma · Esc cancela'}
      </Text>
    </Box>
  )
}

export interface SelectChoice {
  value: string
  label: string
  hint?: string
}

export function SelectList({
  label,
  choices,
  onSubmit,
  onCancel,
  maxVisible = 8,
}: {
  label: string
  choices: SelectChoice[]
  onSubmit(value: string): void
  onCancel(): void
  maxVisible?: number
}) {
  const [index, setIndex] = useState(0)
  const latest = useRef(0)
  const move = (next: number) => {
    latest.current = Math.max(0, Math.min(choices.length - 1, next))
    setIndex(latest.current)
  }
  useInput((input, key) => {
    if (key.escape) return onCancel()
    if (key.upArrow || input === 'k') return move(latest.current - 1)
    if (key.downArrow || input === 'j') return move(latest.current + 1)
    if (key.return) {
      const choice = choices[latest.current]
      if (choice) onSubmit(choice.value)
    }
  })
  const offset = scrollOffset(index, choices.length, maxVisible)
  return (
    <Box flexDirection='column'>
      <Text color={theme.brand} bold>
        {label}
      </Text>
      {choices.slice(offset, offset + maxVisible).map((choice, j) => {
        const i = offset + j
        return (
          <Text
            key={choice.value}
            color={i === index ? theme.brandSoft : undefined}
            bold={i === index}
          >
            {i === index ? `${symbols.info} ` : '  '}
            {choice.label}
            {choice.hint ? (
              <Text color={theme.muted}> {choice.hint}</Text>
            ) : null}
          </Text>
        )
      })}
      <Text color={theme.muted}>
        ↑/↓ escolhe · Enter confirma · Esc cancela
      </Text>
    </Box>
  )
}

/** The dashboard's version of the shared `(s/N)` confirmation. */
export function Confirm({
  question,
  onAnswer,
}: {
  question: string
  onAnswer(yes: boolean): void
}) {
  useInput((input, key) => {
    if (/^[sy]$/i.test(input)) return onAnswer(true)
    if (/^n$/i.test(input) || key.escape || key.return) onAnswer(false)
  })
  return (
    <Text>
      <Text color={theme.warning}>{symbols.warning}</Text> {question}{' '}
      <Text color={theme.muted}>(s/N)</Text>
    </Text>
  )
}

/* ------------------------------------------------------------------ */
/* Help                                                                */
/* ------------------------------------------------------------------ */

export const HELP_KEYS: Array<[string, string]> = [
  ['←/→ ou 1–4', 'troca de aba'],
  ['↑/↓ ou j/k', 'move na lista'],
  ['Enter', 'abre o detalhe'],
  ['/', 'filtra a lista'],
  ['r', 'atualiza a aba'],
  ['p', 'troca o funil (CRM)'],
  ['c', 'comenta no chamado (no detalhe)'],
  ['m', 'move fase ou etapa (no detalhe)'],
  ['Esc', 'volta; na lista, sai'],
  ['q', 'sai do painel'],
  ['?', 'mostra ou esconde esta ajuda'],
]

export function HelpOverlay() {
  const width = Math.max(...HELP_KEYS.map(([key]) => key.length))
  return (
    <Box
      flexDirection='column'
      borderStyle='round'
      borderColor={theme.brand}
      paddingX={1}
    >
      <Text color={theme.brand} bold>
        Atalhos
      </Text>
      {HELP_KEYS.map(([key, text]) => (
        <Text key={key}>
          <Text color={theme.brandSoft}>{key.padEnd(width)}</Text>
          {'  '}
          {text}
        </Text>
      ))}
      <Text color={theme.muted}>Qualquer tecla fecha.</Text>
    </Box>
  )
}
