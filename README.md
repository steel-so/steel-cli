# Steel CLI

`steel` é o Steel no terminal: entre pelo navegador, chame a API pública v1
em scripts e no CI, e (em breve) receba webhooks na sua máquina. Este
repositório também traz o SDK TypeScript `@steel-so/sdk`.

> Comandos de ServiceDesk, CRM e Comunicação e o `steel listen` chegam nas
> próximas versões.

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
steel logout           # apaga o token salvo neste computador
```

O `steel login` usa o fluxo de dispositivo: o terminal mostra um código, você
confirma em `/device` no Steel, escolhe workspace, módulos e escopo
(`api:read` ou `api:write`), e o CLI recebe um token pessoal (`stl_pat_...`).

O token fica no **chaveiro do sistema** (Keychain no macOS, Gerenciador de
Credenciais no Windows, Secret Service no Linux). Sem chaveiro disponível, vai
para `~/.config/steel/credentials` com permissão 600. O `steel logout` só
apaga a cópia local: para invalidar o token, revogue em **Ajustes › Segurança
› Tokens de API**.

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

## Licença

Proprietária. © Stratus Telecom. Veja [LICENSE](LICENSE).
