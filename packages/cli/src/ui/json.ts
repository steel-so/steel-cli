import chalk from 'chalk'
import { theme } from './theme.js'

const TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g

/** Pretty JSON; colored when chalk has colors enabled. */
export function formatJson(value: unknown): string {
  const text = JSON.stringify(value, null, 2) ?? 'null'
  if (chalk.level === 0) return text
  return text.replace(
    TOKEN,
    (match, string: string, colon: string, keyword: string) => {
      if (string !== undefined) {
        return colon
          ? chalk.hex(theme.brandSoft)(string) + colon
          : chalk.hex(theme.success)(string)
      }
      if (keyword !== undefined) return chalk.hex(theme.warning)(match)
      return chalk.hex(theme.brand)(match)
    },
  )
}
