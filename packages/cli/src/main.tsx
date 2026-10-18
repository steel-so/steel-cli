import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { CommanderError } from 'commander'
import { keychainBackend } from './config/credentials.js'
import { configDir } from './config/paths.js'
import { Context, type Deps } from './context.js'
import { CliError, EXIT, usageError } from './errors.js'
import { openBrowser } from './lib/open-browser.js'
import { checkForUpdate } from './lib/update-check.js'
import { buildProgram } from './program.js'
import { Code, Warning } from './ui/components.js'
import { PACKAGE_NAME, upgradeCommand, VERSION } from './version.js'

/** Wait at most this long after the command for the update check. */
const UPDATE_GRACE_MS = 150

function quoted(message: string): string | undefined {
  return /'([^']+)'/.exec(message)?.[1]
}

/** Commander's own errors, in pt-BR with a hint. */
export function translateCommanderError(error: CommanderError): CliError {
  const name = quoted(error.message) ?? ''
  const suggestion = /Did you mean (.+)\?/.exec(error.message)?.[1]
  const hint = suggestion
    ? `Você quis dizer ${suggestion}?`
    : 'Veja as opções com `steel --help`.'
  switch (error.code) {
    case 'commander.unknownCommand':
      return usageError(`Comando desconhecido: ${name}`, hint)
    case 'commander.unknownOption':
      return usageError(`Opção desconhecida: ${name}`, hint)
    case 'commander.missingArgument':
      return usageError(`Falta o argumento ${name}.`, hint)
    case 'commander.optionMissingArgument':
    case 'commander.missingMandatoryOptionValue':
      return usageError(`A opção ${name} precisa de um valor.`, hint)
    case 'commander.excessArguments':
      return usageError('Argumentos demais.', hint)
    default:
      return usageError(error.message.replace(/^error: /, ''), hint)
  }
}

function shouldCheckForUpdates(deps: Deps, argv: string[]): boolean {
  const { env } = deps
  return Boolean(
    deps.live &&
      !argv.includes('--json') &&
      !env.CI &&
      !env.STEEL_NO_UPDATE_NOTIFIER &&
      !argv.includes('__complete') &&
      !argv.includes('completion'),
  )
}

/** Runs the CLI and resolves to the process exit code. Never throws. */
export async function runCli(argv: string[], deps: Deps): Promise<number> {
  const state = { exitCode: EXIT.OK as number }
  const program = buildProgram(deps, state)
  const update = shouldCheckForUpdates(deps, argv)
    ? checkForUpdate({
        dir: configDir(deps.env),
        packageName: PACKAGE_NAME,
        current: VERSION,
        fetch: deps.fetch,
      })
    : undefined

  try {
    if (argv.length === 0) {
      program.outputHelp()
    } else {
      await program.parseAsync(argv, { from: 'user' })
    }
  } catch (error) {
    const ctx = new Context(deps, {
      json: argv.includes('--json'),
    })
    if (error instanceof CommanderError) {
      if (
        error.code === 'commander.helpDisplayed' ||
        error.code === 'commander.help' ||
        error.code === 'commander.version'
      ) {
        return EXIT.OK
      }
      const translated = translateCommanderError(error)
      ctx.printError(translated)
      return translated.exitCode
    }
    const cliError =
      error instanceof CliError
        ? error
        : new CliError('Erro inesperado no Steel CLI.', {
            hint: `${(error as Error)?.message ?? String(error)}. Abra uma issue em https://github.com/steel-so/steel-cli/issues.`,
            code: 'INTERNAL',
            cause: error,
          })
    ctx.printError(cliError)
    return cliError.exitCode
  }

  if (update) {
    const latest = await Promise.race([
      update,
      new Promise<undefined>((resolve) =>
        setTimeout(() => resolve(undefined), UPDATE_GRACE_MS).unref(),
      ),
    ])
    if (latest) {
      new Context(deps, {}).render(
        <Warning>
          Nova versão do Steel CLI: {VERSION} → {latest}. Atualize com{' '}
          <Code>{upgradeCommand()}</Code>.
        </Warning>,
        deps.io.stderr,
      )
    }
  }
  return state.exitCode
}

/** The real process: stdio, keychain, browser, Ctrl+C. */
export function processDeps(): Deps {
  const env = process.env
  const interrupt = new AbortController()
  process.once('SIGINT', () => interrupt.abort())
  return {
    io: {
      stdout: process.stdout,
      stderr: process.stderr,
      readStdin: async () => {
        const chunks: Buffer[] = []
        for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
        return Buffer.concat(chunks).toString('utf8')
      },
    },
    env,
    fetch: globalThis.fetch,
    keychain: env.STEEL_NO_KEYCHAIN ? null : keychainBackend(),
    openBrowser: (url) => openBrowser(url, { env }),
    readFile: (path) => readFile(path, 'utf8'),
    hostname,
    interrupt: interrupt.signal,
    live: Boolean(process.stdout.isTTY),
    stdio: { stdin: process.stdin, stdout: process.stdout },
  }
}
