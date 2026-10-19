import type { Command } from 'commander'
import type { Context } from '../context.js'
import { collect } from '../lib/domain.js'
import * as crm from './crm.js'
import * as sd from './sd.js'
import * as zap from './zap.js'

type Handler = (
  ctx: Context,
  positionals: string[],
  options: Record<string, any>,
) => Promise<unknown>
type Run = (handler: Handler) => (...args: unknown[]) => Promise<void>

function paged(command: Command): Command {
  return command
    .option('--limit <n>', 'itens por página (1 a 100; padrão 25)')
    .option('--cursor <cursor>', 'continua de onde a página anterior parou')
    .option('--all', 'traz todas as páginas')
}

function confirmable(command: Command): Command {
  return command.option('-y, --yes', 'não pede confirmação')
}

/** `steel sd`, `steel crm` and `steel zap` (cli-domain, ADR 0034). */
export function registerDomainCommands(program: Command, run: Run): void {
  /* ServiceDesk */
  const sdCommand = program
    .command('sd')
    .description('ServiceDesk: chamados, fases e catálogo')
  const ticket = sdCommand.command('ticket').description('Chamados')

  paged(
    ticket
      .command('list')
      .description('Lista chamados (só os abertos, sem --status)')
      .option(
        '--status <status>',
        'novo, andamento, aguardando, resolvido, fechado, cancelado (vírgula ou repetido)',
        collect,
      )
      .option(
        '--type <tipo>',
        'incidente, requisicao, mudanca, problema',
        collect,
      )
      .option('--phase <id>', 'id da fase', collect)
      .option('--priority <id>', 'id da prioridade', collect)
      .option('--assignee <id>', 'responsável: id, me ou unassigned', collect)
      .option('-s, --search <texto>', 'busca no título, descrição e código'),
  )
    .addHelpText(
      'after',
      '\nExemplos:\n  steel sd ticket list --assignee me\n  steel sd ticket list --status aguardando --type incidente --all\n',
    )
    .action(run((ctx, _, options) => sd.ticketList(ctx, options)))

  ticket
    .command('view')
    .description('Mostra um chamado')
    .argument('<chamado>', 'id ou número do chamado')
    .action(run((ctx, [id]) => sd.ticketView(ctx, id as string)))

  confirmable(
    ticket
      .command('create')
      .description('Abre um chamado (pergunta o que faltar no terminal)')
      .option('--type <tipo>', 'incidente, requisicao, mudanca ou problema')
      .option('--title <título>', 'título do chamado')
      .option('--description <texto>', 'descrição, @arquivo ou @- (stdin)')
      .option('--service <id>', 'serviço do catálogo (`steel sd catalog`)')
      .option('--category <id>', 'categoria do catálogo')
      .option('--subcategory <id>', 'subcategoria do catálogo')
      .option('--priority <id>', 'id da prioridade')
      .option('--assignee <id>', 'id do responsável')
      .option('--tag <tag>', 'tag (vírgula ou repetido)', collect),
  )
    .addHelpText(
      'after',
      '\nExemplo:\n  steel sd ticket create --type incidente --title "VPN fora do ar" --yes\n',
    )
    .action(run((ctx, _, options) => sd.ticketCreate(ctx, options)))

  confirmable(
    ticket
      .command('comment')
      .description('Comenta em um chamado (público, ou interno com --internal)')
      .argument('<chamado>', 'id ou número do chamado')
      .option('-m, --message <texto>', 'texto, @arquivo ou @- (stdin)')
      .option('--internal', 'comentário interno (o solicitante não vê)'),
  ).action(
    run((ctx, [id], options) => sd.ticketComment(ctx, id as string, options)),
  )

  confirmable(
    ticket
      .command('move')
      .description('Move um chamado para outra fase do fluxo')
      .argument('<chamado>', 'id ou número do chamado')
      .option('--phase <fase>', 'nome ou id da fase de destino')
      .option('--solution <texto>', 'solução, ao resolver (@arquivo ou @-)')
      .option('--comment <texto>', 'comentário da mudança de fase'),
  )
    .addHelpText(
      'after',
      '\nExemplos:\n  steel sd ticket move 42 --phase "Em atendimento"\n  steel sd ticket move 42 --phase Resolvido --solution @solucao.md --yes\n\nSem --phase, num terminal, mostra só as fases para onde o chamado pode ir.\n',
    )
    .action(
      run((ctx, [id], options) => sd.ticketMove(ctx, id as string, options)),
    )

  paged(
    sdCommand
      .command('phases')
      .description('Fases de cada tipo de chamado e para onde cada uma vai')
      .option('--type <tipo>', 'incidente, requisicao, mudanca ou problema'),
  )
    .addHelpText('after', '\nExemplo:\n  steel sd phases --type incidente\n')
    .action(run((ctx, _, options) => sd.phases(ctx, options)))

  paged(
    sdCommand
      .command('catalog')
      .description('Categorias, subcategorias e serviços do catálogo')
      .option('--type <tipo>', 'só os itens de um tipo de chamado'),
  ).action(run((ctx, _, options) => sd.catalog(ctx, options)))

  /* CRM */
  const crmCommand = program
    .command('crm')
    .description('CRM: leads, oportunidades e funis')
  const lead = crmCommand.command('lead').description('Leads')

  paged(
    lead
      .command('list')
      .description('Lista leads')
      .option(
        '--stage <etapa>',
        'recebido, em-contato, qualificado, oportunidade, proposta, fechado',
      ),
  ).action(run((ctx, _, options) => crm.leadList(ctx, options)))

  confirmable(
    lead
      .command('create')
      .description('Cria um lead')
      .option('--name <nome>', 'nome do lead')
      .option('--email <e-mail>', 'e-mail (vírgula ou repetido)', collect)
      .option('--phone <telefone>', 'telefone (vírgula ou repetido)', collect)
      .option('--company <empresa>', 'empresa')
      .option('--job-title <cargo>', 'cargo')
      .option('--city <cidade>', 'cidade')
      .option('--source <origem>', `origem (padrão ${crm.DEFAULT_LEAD_SOURCE})`)
      .option('--channel <canal>', 'canal'),
  ).action(run((ctx, _, options) => crm.leadCreate(ctx, options)))

  confirmable(
    lead
      .command('import')
      .description('Importa leads de um CSV (até 5.000 linhas)')
      .argument('<csv>', 'arquivo CSV com cabeçalho, ou - para stdin')
      .option('--source <origem>', 'origem das linhas sem a coluna source'),
  )
    .addHelpText(
      'after',
      '\nO código de saída é 1 quando alguma linha volta com erro (a resposta lista cada uma).\n',
    )
    .action(
      run((ctx, [file], options) =>
        crm.leadImport(ctx, file as string, options),
      ),
    )

  const opportunity = crmCommand
    .command('opportunity')
    .description('Oportunidades')

  paged(
    opportunity
      .command('list')
      .description('Lista oportunidades')
      .option('--pipeline <id>', 'id do funil')
      .option('--stage <id>', 'id da etapa'),
  ).action(run((ctx, _, options) => crm.opportunityList(ctx, options)))

  confirmable(
    opportunity
      .command('move')
      .description('Move uma oportunidade para outra etapa')
      .argument('<oportunidade>', 'id da oportunidade')
      .option('--stage <etapa>', 'id ou nome da etapa de destino')
      .option('--pipeline <funil>', 'id ou nome do funil (se mudar de funil)'),
  ).action(
    run((ctx, [id], options) =>
      crm.opportunityMove(ctx, id as string, options),
    ),
  )

  paged(
    crmCommand.command('pipelines').description('Funis e as suas etapas'),
  ).action(run((ctx, _, options) => crm.pipelines(ctx, options)))

  /* Comunicação */
  const zapCommand = program
    .command('zap')
    .description(
      'Comunicação (WhatsApp): fila de atendimento, templates, envios e disparos',
    )

  paged(
    zapCommand
      .command('waiting')
      .description(
        'Conversas aguardando atendimento (sem responsável), mais antigas primeiro',
      )
      .option('--connection <id>', 'só desta conexão')
      .option('--team <id>', 'só a fila desta equipe'),
  )
    .addHelpText(
      'after',
      '\nSegue as Equipes do dono do token: a fila geral e as filas das equipes dele.\nResponda com `steel zap send --conversation <id> --template <nome>`.\n',
    )
    .action(run((ctx, _, options) => zap.waiting(ctx, options)))

  paged(
    zapCommand
      .command('templates')
      .description('Lista templates (os aprovados, sem --status)')
      .option(
        '--status <status>',
        'aprovado, pendente, rejeitado, pausado, desativado ou todos',
      )
      .option('--connection <id>', 'id da conexão'),
  ).action(run((ctx, _, options) => zap.templates(ctx, options)))

  confirmable(
    zapCommand
      .command('send')
      .description('Envia um template aprovado')
      .option('--template <nome>', 'nome do template')
      .option('--to <número>', 'número com DDI e DDD, ex.: 5511999990000')
      .option('--contact <id>', 'contato do Steel, em vez de --to')
      .option('--conversation <id>', 'conversa existente, em vez de --to')
      .option('--connection <id>', 'conexão (quando há mais de uma)')
      .option('--language <idioma>', 'idioma do template, ex.: pt_BR')
      .option(
        '--var <chave=valor>',
        'variável do template (repita); cabeçalho: header.1=valor',
        collect,
      ),
  )
    .addHelpText(
      'after',
      '\nExemplo:\n  steel zap send --template boas_vindas --to 5511999990000 --var 1=Ana --yes\n',
    )
    .action(run((ctx, _, options) => zap.send(ctx, options)))

  const broadcast = zapCommand.command('broadcast').description('Disparos')
  broadcast
    .command('status')
    .description('Andamento de um disparo')
    .argument('<id>', 'id do disparo')
    .action(run((ctx, [id]) => zap.broadcastStatus(ctx, id as string)))
}
