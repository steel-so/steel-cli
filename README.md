# Steel CLI

`steel` é o Steel no terminal: entre pelo navegador, chame a API pública v1
em scripts e no CI, e receba os webhooks do Steel na sua máquina. Este
repositório também traz o SDK TypeScript `@steel-so/sdk`.

## Instalação

**Homebrew** (macOS e Linux):

```bash
brew install steel-so/tap/steel
```

**Script** (macOS e Linux; confere o SHA-256 antes de instalar em
`~/.local/bin`):

```bash
curl -fsSL https://raw.githubusercontent.com/steel-so/steel-cli/main/install.sh | sh
# versão e pasta específicas:
curl -fsSL https://raw.githubusercontent.com/steel-so/steel-cli/main/install.sh | STEEL_VERSION=0.2.0 STEEL_INSTALL_DIR=/usr/local/bin sh
```

**npm** (Node.js 22.12 ou mais novo):

```bash
npm install -g @steel-so/cli
```

**Binário avulso:** cada [release](https://github.com/steel-so/steel-cli/releases)
traz `steel-<sistema>-<cpu>` para `linux-x64`, `linux-arm64`, `darwin-x64`,
`darwin-arm64` (`.tar.gz`) e `windows-x64` (`.zip`), sem precisar de Node.js.
No Windows, descompacte o `.zip` e coloque o `steel.exe` numa pasta do `PATH`.

### Conferir o download

Toda release publica `SHA256SUMS` e uma atestação de proveniência assinada
pelo GitHub Actions (Sigstore) para cada arquivo:

```bash
sha256sum --ignore-missing -c SHA256SUMS          # macOS: shasum -a 256 -c
gh attestation verify steel-linux-x64.tar.gz --repo steel-so/steel-cli
```

O pacote npm sai com `--provenance`: `npm audit signatures` confere.

### Versão instalada

```bash
steel --version        # steel 0.2.0 (abc1234, 2026-10-17)
steel version          # versão, commit, data do build, plataforma e instalação
steel version --json
```

## Primeiros passos

```bash
steel login            # abre o navegador; confirme o código e escolha o workspace
steel whoami           # usuário, workspace, escopos, módulos e validade do token
steel api GET /me      # qualquer rota da API v1
steel logout           # revoga o token no Steel e apaga a cópia local
```

O `steel login` usa o fluxo de dispositivo: o terminal mostra um código, você
confirma em `/device` no Steel, escolhe workspace, módulos e escopo
(`api:read` ou `api:write`), e o CLI recebe um token pessoal (`stl_pat_...`).

O token fica no **chaveiro do sistema** (Keychain no macOS, Gerenciador de
Credenciais no Windows, Secret Service no Linux). Sem chaveiro disponível, vai
para `~/.config/steel/credentials` com permissão 600. O `steel logout`
revoga o token salvo no Steel e apaga a cópia local; se o Steel não responder,
ele apaga a cópia mesmo assim e avisa — aí revogue em **Ajustes › Segurança ›
Tokens de API**. Um token em `STEEL_TOKEN` não é revogado.

## Painel interativo

`steel` sem comando, num terminal, abre um painel em tela cheia com o perfil,
o workspace e o usuário no topo e quatro abas:

| Aba | O que mostra | Ações no detalhe |
| --- | --- | --- |
| **ServiceDesk** | a sua fila (chamados abertos com você), estourados e em risco primeiro | `c` comenta (Tab alterna público/interno), `m` move de fase |
| **CRM** | oportunidades por etapa do funil, com quantidade e valor de cada etapa; `p` troca o funil | `m` move de etapa |
| **Comunicação** | templates aprovados (as conversas aguardando ainda não estão na API v1) | comando para enviar o template |
| **Webhooks** | eventos do workspace ao vivo, como no `steel listen` (OWNER/ADMIN) | corpo do evento e assinatura |

| Tecla | Faz |
| --- | --- |
| `←`/`→`, `Tab` ou `1`–`4` | troca de aba |
| `↑`/`↓` ou `j`/`k` | move na lista (`PgUp`/`PgDn`, `Home`/`End`) |
| `Enter` | abre o detalhe |
| `/` | filtra a lista (Enter aplica, Esc limpa) |
| `r` | atualiza a aba (no Webhooks, reconecta) |
| `?` | ajuda com todos os atalhos |
| `Esc` | volta; na lista, sai |
| `q` ou `Ctrl+C` | sai |

Toda alteração pede confirmação (`s/N`) antes de ir para o Steel, como nos
comandos. Cada aba carrega na primeira vez que é aberta: um módulo fora do
token ou um erro (sem rede, `403`) aparece só na aba, com a dica do que
fazer; token vencido ou revogado pede `steel login`. O painel se ajusta ao
tamanho do terminal e respeita `NO_COLOR`/`--no-color` (a linha selecionada
é marcada com `›`). Use `steel --profile <nome>` para abrir outro perfil.

Fora de um terminal (pipe, CI), `steel` sem comando só mostra a ajuda.

## Perfis

Cada perfil tem uma URL e o seu próprio login.

```bash
steel profile list                       # perfis; * marca o atual
steel profile use homologacao            # troca o perfil atual
steel profile add local --url http://localhost:3001 --use
steel whoami --profile homologacao       # um comando em outro perfil
```

Perfis prontos: `homologacao` (`https://homologacao.stratustelecom.com.br`,
o padrão) e `producao` (a URL de produção ainda será definida).

## `steel api`

```bash
steel api GET /servicedesk/tickets -q limit=5 -q status=open
steel api POST /crm/leads -d '{"name":"Ana","email":"ana@exemplo.com"}'
steel api POST /crm/leads -d @lead.json
cat lead.json | steel api POST /crm/leads -d @-
```

O caminho é relativo a `/api/v1` (`/me` e `/api/v1/me` são a mesma rota). A
resposta sai em JSON no stdout, inclusive em erro; o código de saída indica o
resultado.

## ServiceDesk, CRM e Comunicação

```bash
steel sd ticket list --assignee me --status aguardando   # só os abertos, sem --status
steel sd ticket view 42                                   # id ou número
steel sd ticket create --type incidente --title "VPN fora do ar"
steel sd ticket comment 42 -m "Já estamos olhando" --internal
steel sd ticket move 42 --phase <id-da-fase> --solution @solucao.md
steel sd catalog --type requisicao

steel crm lead list --stage qualificado
steel crm lead create --name "Ana Souza" --email ana@exemplo.com
steel crm lead import leads.csv --source Feira             # até 5.000 linhas
steel crm opportunity list --pipeline <id>
steel crm opportunity move <id> --stage Proposta --pipeline Vendas
steel crm pipelines

steel zap templates                                       # aprovados; --status todos
steel zap send --template boas_vindas --to 5511999990000 --var 1=Ana
steel zap broadcast status <id>
```

- **Listas** vêm em páginas: `--limit` (1 a 100, padrão 25), `--cursor`
  (o próximo é sugerido no fim da tabela) e `--all` (todas as páginas).
  Em JSON, a saída é `{ "items": [...], "nextCursor": "..." | null }`.
- **No terminal**, o que faltar (tipo e título do chamado, etapa, template,
  número, variáveis...) é perguntado, e toda alteração pede confirmação.
  `--yes` pula a confirmação. Fora de um terminal (scripts, CI) nada é
  perguntado: falta de opção obrigatória é erro de uso (código 2).
- `--type`, `--status` e `--stage` aceitam o nome em português
  (`incidente`, `aguardando`, `em-contato`) ou o valor da API (`INCIDENT`).
- Textos longos (`--description`, `-m`, `--solution`) aceitam `@arquivo` ou
  `@-` (stdin).
- `steel crm lead import` sai com código 1 quando alguma linha volta com
  erro; a resposta lista cada linha.
- `steel zap send`: variáveis do corpo como `--var 1=Ana` (ou
  `--var nome=Ana`), do cabeçalho como `--var header.1=valor`. Em vez de
  `--to`, use `--contact <id>` ou `--conversation <id>`.

## Webhooks na sua máquina

`steel listen` recebe em tempo real os eventos de webhook do workspace (é
preciso ser OWNER/ADMIN) e, com `--forward`, repassa cada um para o seu app
local com o **mesmo corpo e os mesmos cabeçalhos** que o Steel envia
(`Steel-Webhook-Id`, `Steel-Webhook-Timestamp`, `Steel-Signature`). Assim a
verificação de assinatura do seu app roda igual à de produção.

```bash
steel listen                                          # todos os eventos
steel listen --events crm.lead.created,crm.deal.won   # só estes tipos
steel listen --forward localhost:3001/api/webhooks/steel
steel listen --print                                  # mostra o corpo de cada evento
```

Ao conectar, o `steel listen` mostra o **segredo de assinatura** da escuta
(`whsec_...`): configure-o no app local para validar as requisições
repassadas. Cada linha mostra a hora, o tipo, o id do evento e, com
`--forward`, o código HTTP e o tempo de resposta do seu app. Se a conexão
cair, o CLI reconecta sozinho (1, 2, 4… até 30 s). Ctrl+C encerra.

Fora de um terminal (ou com `--json`), cada evento sai como uma linha JSON
(NDJSON) no stdout, bom para `jq`:

```bash
steel listen --json | jq -r 'select(.type == "webhook") | .eventType'
```

Para gerar um evento de teste com os dados de exemplo do catálogo, em outro
terminal:

```bash
steel trigger crm.lead.created                    # chega a quem está com steel listen
steel trigger crm.deal.won --endpoint <id>        # e também a este endpoint
```

### Endpoints e entregas

```bash
steel webhooks events                             # catálogo de eventos
steel webhooks endpoints list
steel webhooks endpoints create --url https://erp.exemplo.com/steel --events "*"
steel webhooks endpoints test <id>                # envia um steel.ping e mostra a resposta
steel webhooks endpoints delete <id>              # pede confirmação; --yes em scripts
steel webhooks deliveries list --endpoint <id> --status FAILED
steel webhooks deliveries retry <id>              # reenvia (mesmo corpo e mesmo id)
```

O segredo de um endpoint novo só aparece na criação: guarde-o na hora.

## Scripts e CI

| Variável | Para quê |
| --- | --- |
| `STEEL_TOKEN` | token pessoal; tem precedência sobre o login salvo |
| `STEEL_URL` | URL do Steel; tem precedência sobre a do perfil |
| `STEEL_PROFILE` | perfil a usar, como `--profile` |
| `STEEL_CONFIG_DIR` | pasta de configuração (padrão `~/.config/steel`) |
| `STEEL_NO_KEYCHAIN` | não usa o chaveiro; guarda o token no arquivo |
| `STEEL_NO_UPDATE_NOTIFIER` | não avisa sobre versão nova |
| `STEEL_MCP_TOKEN` | token de acesso do MCP para o `steel mcp` |
| `NO_COLOR` | saída sem cores |

Com `--json`, ou quando a saída não é um terminal, os comandos escrevem JSON
estável no stdout, sem cores. Erros saem no stderr como
`{"error":{"code","message","hint"}}`.

| Código de saída | Significado |
| --- | --- |
| 0 | sucesso |
| 1 | erro (rede, servidor, resposta HTTP de erro) |
| 2 | uso incorreto (comando, opção ou argumento) |
| 3 | autenticação (sem login, token inválido ou sem permissão) |
| 130 | cancelado (Ctrl+C) |

## Autocomplete

```bash
steel completion bash > ~/.local/share/bash-completion/completions/steel
steel completion zsh > "${fpath[1]}/_steel"
steel completion fish > ~/.config/fish/completions/steel.fish
```

## `steel mcp`

Ponte stdio para o servidor MCP do Steel (`<URL do perfil>/api/mcp`), para
clientes de IA que só falam MCP por stdio ou não fazem o OAuth do Steel. O
`steel mcp` repassa cada mensagem sem alterar e envia o token como
`Authorization: Bearer`.

```json
{
  "mcpServers": {
    "steel": {
      "command": "steel",
      "args": ["mcp", "--profile", "homologacao"],
      "env": { "STEEL_MCP_TOKEN": "<token de acesso do MCP>" }
    }
  }
}
```

- O token é um **token de acesso OAuth do MCP do Steel** (o mesmo que um
  cliente compatível recebe depois do consentimento), não o `stl_pat_` do
  `steel login`. Passe por `STEEL_MCP_TOKEN` (de preferência) ou `--token`.
- Revogue em **Ajustes › Apps conectados**.
- O stdout é do protocolo: avisos e erros saem no stderr, em JSON.
- Se o Steel recusar uma requisição (token inválido, sem permissão, fora do
  ar), o cliente recebe um erro JSON-RPC na hora, sem ficar esperando.

## SDK

```ts
import { createSteelClient } from '@steel-so/sdk'

const steel = createSteelClient({
  baseUrl: 'https://homologacao.stratustelecom.com.br',
  token: process.env.STEEL_TOKEN,
})

const me = await steel.me()
if (me.ok) console.log(me.data.workspace.name)
else console.error(me.error.code)

// Cliente tipado de toda a API v1 (openapi-fetch):
const { data } = await steel.api.GET('/api/v1/me')
```

O SDK não lança exceção em erro HTTP ou de rede: toda chamada resolve em
`{ ok: true, data }` ou `{ ok: false, error: { status, code, message } }`.

### Verificar a assinatura de um webhook

```ts
import { verifySignature } from '@steel-so/sdk'

// rawBody: o corpo exato recebido, antes de qualquer JSON.parse
const valid = verifySignature(
  process.env.STEEL_WEBHOOK_SECRET,
  request.headers.get('steel-signature'),
  request.headers.get('steel-webhook-timestamp'),
  rawBody,
)
if (!valid) return new Response('assinatura inválida', { status: 401 })
```

A assinatura é `v1=<hex do HMAC-SHA256 de "<timestamp>.<corpo>">` com o
segredo do endpoint. `verifySignature` compara em tempo constante, aceita
várias assinaturas separadas por vírgula (troca de segredo) e recusa
timestamps a mais de 5 minutos do relógio local (ajuste com
`{ toleranceSeconds }`). Nunca lança exceção.

Os módulos têm atalhos tipados: `steel.servicedesk.tickets.list()`,
`steel.crm.leads.import(csv)`, `steel.whatsapp.sendTemplate(...)` e o
`collectAll(...)` para percorrer todas as páginas de uma lista.

O SDK também expõe `steel.webhooks` (catálogo, endpoints, entregas,
`trigger`) e `steel.webhooks.listen()`, o stream SSE usado pelo
`steel listen`.

## Licença

Proprietária. © Stratus Telecom. Veja [LICENSE](LICENSE).
