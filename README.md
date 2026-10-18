# Steel CLI

`steel` é o Steel no terminal: entre pelo navegador, chame a API pública v1
em scripts e no CI, e (em breve) receba webhooks na sua máquina. Este
repositório também traz o SDK TypeScript `@steel-so/sdk`.

> Versão inicial. Comandos de ServiceDesk, CRM e Comunicação, `steel listen`
> e os binários por plataforma chegam nas próximas versões.

## Instalação

```bash
npm install -g @steel-so/cli   # Node.js 22.12 ou mais novo
steel --version
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
