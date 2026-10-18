import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { symbols, theme } from './theme.js'

export function Success({ children }: { children: ReactNode }) {
  return (
    <Text>
      <Text color={theme.success}>{symbols.success}</Text> {children}
    </Text>
  )
}

export function Warning({ children }: { children: ReactNode }) {
  return (
    <Text>
      <Text color={theme.warning}>{symbols.warning}</Text> {children}
    </Text>
  )
}

export function Hint({ children }: { children: ReactNode }) {
  return (
    <Text color={theme.muted}>
      {'  '}
      {symbols.info} {children}
    </Text>
  )
}

export function ErrorMessage({
  message,
  hint,
}: {
  message: string
  hint?: string
}) {
  return (
    <Box flexDirection='column'>
      <Text>
        <Text color={theme.danger} bold>
          {symbols.error}
        </Text>{' '}
        {message}
      </Text>
      {hint ? <Hint>{hint}</Hint> : null}
    </Box>
  )
}

/** Inline code (`steel login`) in the brand color. */
export function Code({ children }: { children: ReactNode }) {
  return <Text color={theme.brandSoft}>{children}</Text>
}

export function KeyValue({ rows }: { rows: Array<[string, ReactNode]> }) {
  const width = Math.max(...rows.map(([label]) => label.length))
  return (
    <Box flexDirection='column'>
      {rows.map(([label, value]) => (
        <Box key={label}>
          <Box width={width + 2} flexShrink={0}>
            <Text color={theme.muted}>{label}</Text>
          </Box>
          <Text>{value}</Text>
        </Box>
      ))}
    </Box>
  )
}

export interface Column<Row> {
  key: keyof Row & string
  label: string
}

/** Plain-text table: bold brand header, muted rule, padded columns. */
export function Table<Row extends Record<string, string>>({
  columns,
  rows,
  highlight,
}: {
  columns: Array<Column<Row>>
  rows: Row[]
  /** Rows rendered in the brand color (e.g. the current profile). */
  highlight?: (row: Row) => boolean
}) {
  const widths = columns.map((column) =>
    Math.max(
      column.label.length,
      ...rows.map((row) => (row[column.key] ?? '').length),
    ),
  )
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => cell.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd()
  return (
    <Box flexDirection='column'>
      <Text color={theme.brand} bold>
        {line(columns.map((column) => column.label.toUpperCase()))}
      </Text>
      <Text color={theme.muted}>
        {line(widths.map((width) => '─'.repeat(width)))}
      </Text>
      {rows.map((row, index) => (
        <Text
          key={index}
          color={highlight?.(row) ? theme.brandSoft : undefined}
        >
          {line(columns.map((column) => row[column.key] ?? ''))}
        </Text>
      ))}
    </Box>
  )
}
