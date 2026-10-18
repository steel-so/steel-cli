import { createInterface } from 'node:readline/promises'
import type { Readable, Writable } from 'node:stream'
import chalk from 'chalk'
import { CliError, EXIT } from '../errors.js'
import { symbols, theme } from '../ui/theme.js'

export interface Choice<T extends string = string> {
  value: T
  label: string
  hint?: string
}

export interface TextOptions {
  /** Shown in brackets and returned on an empty answer. */
  default?: string
  /** Asks again on an empty answer (when there is no default). */
  required?: boolean
}

/**
 * Questions asked on a terminal when a required flag is missing or before a
 * write. Only built when stdin and stdout are TTYs; commands never prompt
 * otherwise (ADR 0034: scripts must not hang).
 */
export interface Prompter {
  text(message: string, options?: TextOptions): Promise<string>
  select<T extends string>(message: string, choices: Choice<T>[]): Promise<T>
  confirm(message: string, defaultValue?: boolean): Promise<boolean>
}

export function cancelled(): CliError {
  return new CliError('Operação cancelada.', {
    code: 'CANCELLED',
    exitCode: EXIT.CANCELLED,
  })
}

const YES = new Set(['s', 'sim', 'y', 'yes'])
const NO = new Set(['n', 'nao', 'não', 'no'])

/** Plain readline prompts on stderr, so stdout stays clean for pipes. */
export function readlinePrompter(
  input: Readable,
  output: Writable,
  signal?: AbortSignal,
): Prompter {
  const ask = async (question: string): Promise<string> => {
    if (signal?.aborted) throw cancelled()
    const rl = createInterface({ input, output, terminal: false })
    try {
      return (await rl.question(question, { signal })).trim()
    } catch {
      throw cancelled()
    } finally {
      rl.close()
    }
  }
  const mark = chalk.hex(theme.brand)('?')
  const muted = (text: string) => chalk.gray(text)

  return {
    async text(message, options = {}) {
      const suffix = options.default ? muted(` (${options.default})`) : ''
      for (;;) {
        const answer = await ask(`${mark} ${message}${suffix} `)
        if (answer) return answer
        if (options.default !== undefined) return options.default
        if (!options.required) return ''
        output.write(`${muted(`  ${symbols.info} Resposta obrigatória.`)}\n`)
      }
    },
    async select(message, choices) {
      output.write(`${mark} ${message}\n`)
      choices.forEach((choice, index) => {
        const hint = choice.hint ? muted(`  ${choice.hint}`) : ''
        output.write(
          `  ${chalk.hex(theme.brandSoft)(String(index + 1).padStart(2))}) ${choice.label}${hint}\n`,
        )
      })
      for (;;) {
        const answer = await ask(`${muted(`  Escolha 1–${choices.length}:`)} `)
        const index = Number(answer) - 1
        const choice = Number.isInteger(index) ? choices[index] : undefined
        if (choice) return choice.value
        output.write(
          `${muted(`  ${symbols.info} Digite um número da lista.`)}\n`,
        )
      }
    },
    async confirm(message, defaultValue = true) {
      const options = defaultValue ? 'S/n' : 's/N'
      for (;;) {
        const answer = (
          await ask(`${mark} ${message} ${muted(`(${options})`)} `)
        ).toLowerCase()
        if (!answer) return defaultValue
        if (YES.has(answer)) return true
        if (NO.has(answer)) return false
      }
    },
  }
}
