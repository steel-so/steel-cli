import { Command, Help } from 'commander'
import { api } from './commands/api.js'
import { completionScript } from './commands/completion.js'
import { registerDomainCommands } from './commands/domain.js'
import { login } from './commands/login.js'
import { logout } from './commands/logout.js'
import {
  profileAdd,
  profileList,
  profileNames,
  profileUse,
} from './commands/profile.js'
import { whoami } from './commands/whoami.js'
import { Context, type Deps, type GlobalOptions } from './context.js'
import { VERSION } from './version.js'

const TITLES: Record<string, string> = {
  'Usage:': 'Uso:',
  'Options:': 'Opções:',
  'Commands:': 'Comandos:',
  'Arguments:': 'Argumentos:',
  'Global Options:': 'Opções globais:',
}

function translateTerms(text: string): string {
  return text.replace('[options]', '[opções]').replace('[command]', '[comando]')
}

class PtBrHelp extends Help {
  override styleTitle(title: string): string {
    return super.styleTitle(TITLES[title] ?? title)
  }

  override styleUsage(usage: string): string {
    return super.styleUsage(translateTerms(usage))
  }

  override styleSubcommandTerm(term: string): string {
    return super.styleSubcommandTerm(translateTerms(term))
  }
}

type Handler = (
  ctx: Context,
  positionals: string[],
  options: Record<string, any>,
) => Promise<unknown>

export interface ProgramState {
  exitCode: number
}

/** Builds the `steel` command tree. Actions set `state.exitCode`. */
export function buildProgram(deps: Deps, state: ProgramState): Command {
  const program = new Command('steel')

  const run =
    (handler: Handler) =>
    async (...args: unknown[]) => {
      const command = args.pop() as Command
      const options = args.pop() as Record<string, any>
      const ctx = new Context(deps, command.optsWithGlobals<GlobalOptions>())
      const code = await handler(ctx, args as string[], options)
      state.exitCode = typeof code === 'number' ? code : 0
    }

  program
    .description('Steel no terminal: login, chamadas à API v1 e automações.')
    .version(VERSION, '-v, --version', 'mostra a versão')
    .helpOption('-h, --help', 'mostra a ajuda')
    .helpCommand('help [comando]', 'Mostra a ajuda de um comando')
    .option('--json', 'saída em JSON (padrão fora de um terminal)')
    .option('--profile <nome>', 'perfil a usar (veja `steel profile list`)')
    .option('--no-color', 'desliga as cores (também com NO_COLOR)')
    .configureHelp({ showGlobalOptions: true, sortSubcommands: false })
    .showSuggestionAfterError(true)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => deps.io.stdout.write(text),
      writeErr: (text) => deps.io.stderr.write(text),
      outputError: () => {},
    })

  program
    .command('login')
    .description('Entra no Steel pelo navegador e guarda o token')
    .option('--no-browser', 'não abre o navegador; só mostra o link')
    .action(run((ctx, _, options) => login(ctx, { browser: options.browser })))

  program
    .command('logout')
    .description('Apaga o token salvo do perfil')
    .action(run((ctx) => logout(ctx)))

  program
    .command('whoami')
    .description('Mostra usuário, workspace e validade do token')
    .action(run((ctx) => whoami(ctx)))

  const profile = program
    .command('profile')
    .description('Gerencia perfis (produção, homologação e outros)')

  profile
    .command('list')
    .description('Lista os perfis')
    .action(run((ctx) => profileList(ctx)))

  profile
    .command('use')
    .description('Escolhe o perfil atual')
    .argument('<nome>', 'nome do perfil')
    .action(run((ctx, [name]) => profileUse(ctx, name as string)))

  profile
    .command('add')
    .description('Cria um perfil com outra URL do Steel')
    .argument('<nome>', 'nome do perfil')
    .requiredOption('--url <url>', 'URL do Steel (https://...)')
    .option('--use', 'torna o perfil o atual')
    .option('--force', 'troca a URL de um perfil que já existe')
    .action(
      run((ctx, [name], options) =>
        profileAdd(ctx, name as string, {
          url: options.url,
          use: options.use,
          force: options.force,
        }),
      ),
    )

  program
    .command('api')
    .description('Chama qualquer rota da API v1 com o token do perfil')
    .argument('<método>', 'GET, POST, PUT, PATCH ou DELETE')
    .argument('<caminho>', 'rota da API v1, ex.: /me ou /crm/leads?limit=5')
    .option('-d, --data <json>', 'corpo JSON, @arquivo.json ou @- (stdin)')
    .option(
      '-q, --query <chave=valor>',
      'parâmetro de query (repita para mais de um)',
      (value: string, previous: string[] = []) => [...previous, value],
    )
    .addHelpText(
      'after',
      '\nExemplos:\n  steel api GET /me\n  steel api GET /servicedesk/tickets -q limit=5\n  steel api POST /crm/leads -d \'{"name":"Ana"}\'\n',
    )
    .action(
      run((ctx, [method, path], options) =>
        api(ctx, method as string, path as string, {
          data: options.data,
          query: options.query,
        }),
      ),
    )

  registerDomainCommands(program, run)

  program
    .command('completion')
    .description('Imprime o autocomplete do shell (bash, zsh ou fish)')
    .argument('<shell>', 'bash, zsh ou fish')
    .addHelpText(
      'after',
      `\nInstalação:\n  bash  steel completion bash > ~/.local/share/bash-completion/completions/steel\n  zsh   steel completion zsh > "\${fpath[1]}/_steel"\n  fish  steel completion fish > ~/.config/fish/completions/steel.fish\n`,
    )
    .action(
      run(async (ctx, [shell]) => {
        ctx.io.stdout.write(completionScript(program, shell as string))
      }),
    )

  program
    .command('__complete', { hidden: true })
    .argument('<what>')
    .action(
      run(async (ctx, [what]) => {
        if (what === 'profiles') await profileNames(ctx)
      }),
    )

  const applyPtBrHelp = (command: Command) => {
    command.createHelp = () =>
      Object.assign(new PtBrHelp(), command.configureHelp())
    command.commands.forEach(applyPtBrHelp)
  }
  applyPtBrHelp(program)

  return program
}
