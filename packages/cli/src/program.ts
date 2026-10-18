import { Command, Help } from 'commander'
import { api } from './commands/api.js'
import { completionScript } from './commands/completion.js'
import { registerDomainCommands } from './commands/domain.js'
import { listen } from './commands/listen.js'
import { login } from './commands/login.js'
import { logout } from './commands/logout.js'
import {
  profileAdd,
  profileList,
  profileNames,
  profileUse,
} from './commands/profile.js'
import { trigger } from './commands/trigger.js'
import {
  DELIVERY_STATUSES,
  deliveriesList,
  deliveriesRetry,
  endpointsCreate,
  endpointsDelete,
  endpointsList,
  endpointsTest,
  webhooksEvents,
} from './commands/webhooks.js'
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
    .command('listen')
    .description('Recebe os eventos de webhook do workspace em tempo real')
    .option(
      '-e, --events <tipos>',
      'só estes tipos, separados por vírgula (padrão: todos)',
    )
    .option(
      '-f, --forward <url>',
      'repassa cada evento para esta URL local (ex.: localhost:3001/webhooks)',
    )
    .option('-p, --print', 'mostra o corpo JSON de cada evento')
    .addHelpText(
      'after',
      '\nExemplos:\n  steel listen\n  steel listen --events crm.lead.created,crm.deal.won\n  steel listen --forward localhost:3001/api/webhooks/steel\n\nEm outro terminal, `steel trigger crm.lead.created` gera um evento de teste.\n',
    )
    .action(
      run((ctx, _, options) =>
        listen(ctx, {
          events: options.events,
          forward: options.forward,
          print: options.print,
        }),
      ),
    )

  program
    .command('trigger')
    .description(
      'Dispara um evento de teste com os dados de exemplo do catálogo',
    )
    .argument('<tipo>', 'tipo do evento (veja `steel webhooks events`)')
    .option('--endpoint <id>', 'também entrega a este endpoint')
    .action(
      run((ctx, [type], options) =>
        trigger(ctx, type as string, { endpoint: options.endpoint }),
      ),
    )

  const webhooks = program
    .command('webhooks')
    .description('Catálogo de eventos, endpoints e log de entregas')

  webhooks
    .command('events')
    .description('Lista os tipos de evento que o Steel envia')
    .action(run((ctx) => webhooksEvents(ctx)))

  const endpoints = webhooks
    .command('endpoints')
    .description('Endpoints que recebem os webhooks (OWNER/ADMIN)')

  endpoints
    .command('list')
    .description('Lista os endpoints do workspace')
    .action(run((ctx) => endpointsList(ctx)))

  endpoints
    .command('create')
    .description('Cadastra um endpoint e mostra o segredo de assinatura')
    .requiredOption('--url <url>', 'URL HTTPS que recebe os eventos')
    .requiredOption(
      '--events <tipos>',
      'tipos separados por vírgula, ou "*" para todos',
    )
    .option('--description <texto>', 'descrição do endpoint')
    .option('--inactive', 'cadastra desativado')
    .action(
      run((ctx, _, options) =>
        endpointsCreate(ctx, {
          url: options.url,
          events: options.events,
          description: options.description,
          active: !options.inactive,
        }),
      ),
    )

  endpoints
    .command('delete')
    .description('Remove um endpoint')
    .argument('<id>', 'ID do endpoint')
    .option('-y, --yes', 'não pede confirmação')
    .action(
      run((ctx, [id], options) =>
        endpointsDelete(ctx, id as string, { yes: options.yes }),
      ),
    )

  endpoints
    .command('test')
    .description('Envia um steel.ping ao endpoint e mostra a resposta')
    .argument('<id>', 'ID do endpoint')
    .action(run((ctx, [id]) => endpointsTest(ctx, id as string)))

  const deliveries = webhooks
    .command('deliveries')
    .description('Log de entregas dos últimos 30 dias')

  deliveries
    .command('list')
    .description('Lista as entregas, mais novas primeiro')
    .option('--endpoint <id>', 'só deste endpoint')
    .option('--status <estado>', DELIVERY_STATUSES.join(', '))
    .option('--limit <n>', 'entregas por página (1 a 100, padrão 25)')
    .option('--cursor <cursor>', 'continua de uma página anterior')
    .option('--all', 'busca todas as páginas')
    .action(
      run((ctx, _, options) =>
        deliveriesList(ctx, {
          endpoint: options.endpoint,
          status: options.status,
          limit: options.limit,
          cursor: options.cursor,
          all: options.all,
        }),
      ),
    )

  deliveries
    .command('retry')
    .description('Reenvia uma entrega (mesmo corpo e mesmo id)')
    .argument('<id>', 'ID da entrega')
    .action(run((ctx, [id]) => deliveriesRetry(ctx, id as string)))

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
