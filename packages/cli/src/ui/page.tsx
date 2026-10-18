import { Text } from 'ink'
import type { ReactNode } from 'react'
import type { Context } from '../context.js'
import { Code, Hint } from './components.js'
import { theme } from './theme.js'

/**
 * Prints a list page: the JSON page (`{ items, nextCursor }`) in machine
 * mode, otherwise the table, an empty-state line and a "more" hint.
 */
export function printPage<T>(
  ctx: Context,
  page: { items: T[]; nextCursor: string | null },
  options: {
    /** Command to repeat in the hint, e.g. `steel sd ticket list`. */
    command: string
    empty: string
    table: (items: T[]) => ReactNode
  },
): void {
  if (ctx.json) {
    ctx.printJson(page)
    return
  }
  if (page.items.length === 0) {
    ctx.render(<Text color={theme.muted}>{options.empty}</Text>)
    return
  }
  ctx.render(
    <>
      {options.table(page.items)}
      {page.nextCursor ? (
        <Hint>
          {page.items.length} itens nesta página. Próxima:{' '}
          <Code>
            {options.command} --cursor {page.nextCursor}
          </Code>{' '}
          ou traga tudo com <Code>--all</Code>.
        </Hint>
      ) : (
        <Text color={theme.muted}>
          {page.items.length} {page.items.length === 1 ? 'item' : 'itens'}.
        </Text>
      )}
    </>,
  )
}
