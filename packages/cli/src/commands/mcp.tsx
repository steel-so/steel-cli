import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { configDir } from '../config/paths.js'
import type { Context, Target } from '../context.js'
import { CliError, EXIT } from '../errors.js'
import { runBridge, TOKEN_UNAUTHORIZED_HINT } from '../lib/mcp-bridge.js'
import {
  loginMcp,
  McpAuthorizationError,
  type McpCredential,
  McpLoginCancelledError,
  McpLoginRequiredError,
  McpLoginTimeoutError,
  revokeMcp,
} from '../lib/mcp-oauth.js'
import { McpSession } from '../lib/mcp-session.js'
import { Hint, Success, Warning } from '../ui/components.js'
import { VERSION } from '../version.js'

export interface McpOptions {
  token?: string
  /** `false` (`--no-login`): never open the browser from `steel mcp`. */
  login?: boolean
}

export interface McpLoginOptions {
  browser: boolean
}

function session(ctx: Context, target: Target): McpSession {
  return new McpSession({
    credentials: ctx.credentials,
    dir: configDir(ctx.env),
    profile: target.profileName,
    url: target.url,
    fetch: ctx.deps.fetch,
  })
}

function loginCommand(profile: string): string {
  return `steel mcp login --profile ${profile}`
}

function loginRequired(
  profile: string,
  reason: McpLoginRequiredError['reason'],
): CliError {
  return new CliError(
    reason === 'missing'
      ? `O MCP do Steel ainda não foi autorizado no perfil “${profile}”.`
      : `O login do MCP do Steel no perfil “${profile}” expirou ou foi revogado.`,
    {
      hint: `Rode \`${loginCommand(profile)}\` num terminal ou defina STEEL_MCP_TOKEN.`,
      code: 'MCP_LOGIN_REQUIRED',
      exitCode: EXIT.AUTH,
    },
  )
}

/** stdout may be the MCP protocol: every notice goes to stderr. */
function notice(ctx: Context, text: string): void {
  ctx.io.stderr.write(`${text}\n`)
}

/** Login errors → what the user reads. */
export function loginFailure(error: unknown, url: string): CliError {
  if (error instanceof McpLoginCancelledError) {
    return new CliError('Login do MCP cancelado.', {
      code: 'CANCELLED',
      exitCode: EXIT.CANCELLED,
    })
  }
  if (error instanceof McpLoginTimeoutError) {
    return new CliError('O tempo para autorizar no navegador acabou.', {
      hint: 'Rode o login de novo e conclua a autorização em até 5 minutos.',
      code: 'MCP_LOGIN_TIMEOUT',
      exitCode: EXIT.AUTH,
    })
  }
  if (error instanceof McpAuthorizationError) {
    return error.error === 'access_denied'
      ? new CliError('A autorização do MCP foi recusada no Steel.', {
          code: 'MCP_ACCESS_DENIED',
          exitCode: EXIT.AUTH,
          cause: error,
        })
      : new CliError(`O Steel não concluiu a autorização (${error.error}).`, {
          hint: error.description,
          code: 'MCP_AUTHORIZATION_FAILED',
          exitCode: EXIT.AUTH,
          cause: error,
        })
  }
  return new CliError(`Não foi possível autorizar o MCP do Steel em ${url}.`, {
    hint: `${(error as Error)?.message ?? String(error)}. Confira a conexão e a URL do perfil (\`steel profile list\`).`,
    code: 'MCP_LOGIN_FAILED',
    cause: error,
  })
}

/**
 * Browser login. With `requireBrowser`, gives up (login required) instead
 * of waiting when no browser opens: inside `steel mcp` nobody may be
 * reading stderr.
 */
async function browserLogin(
  ctx: Context,
  target: Target,
  options: { browser: boolean; requireBrowser: boolean },
): Promise<McpCredential> {
  try {
    return await loginMcp({
      url: target.url,
      fetch: ctx.deps.fetch,
      clientName: `Steel CLI (${ctx.deps.hostname()})`,
      signal: ctx.deps.interrupt,
      openBrowser: (url) =>
        options.browser ? ctx.deps.openBrowser(url) : Promise.resolve(false),
      onAuthorizationUrl: (url, opened) => {
        if (!opened && options.requireBrowser) {
          throw new McpLoginRequiredError('missing')
        }
        notice(
          ctx,
          opened
            ? `Abrimos o navegador para autorizar o MCP do Steel no perfil ${target.profileName}. Se não abriu, acesse:\n${url}`
            : `Para autorizar o MCP do Steel no perfil ${target.profileName}, abra no navegador:\n${url}`,
        )
        notice(ctx, 'Aguardando a autorização no navegador…')
      },
    })
  } catch (error) {
    if (error instanceof McpLoginRequiredError) {
      throw loginRequired(target.profileName, error.reason)
    }
    throw loginFailure(error, target.url)
  }
}

function canLoginFromBridge(ctx: Context, options: McpOptions): boolean {
  return options.login !== false && !ctx.env.CI && !ctx.env.STEEL_MCP_NO_LOGIN
}

/** A token that works now: stored (refreshed if needed) or a fresh login. */
async function ensureCredential(
  ctx: Context,
  target: Target,
  mcpSession: McpSession,
  options: McpOptions,
): Promise<void> {
  try {
    await mcpSession.accessToken()
    return
  } catch (error) {
    if (!(error instanceof McpLoginRequiredError)) {
      throw new CliError('Não foi possível renovar o token do MCP do Steel.', {
        hint: `${(error as Error)?.message ?? String(error)}. Confira a conexão e tente de novo.`,
        code: 'MCP_REFRESH_FAILED',
        cause: error,
      })
    }
    if (!canLoginFromBridge(ctx, options)) {
      throw loginRequired(target.profileName, error.reason)
    }
  }
  notice(
    ctx,
    `O MCP do Steel ainda não está autorizado no perfil ${target.profileName}: vamos autorizar pelo navegador.`,
  )
  const credential = await browserLogin(ctx, target, {
    browser: true,
    requireBrowser: true,
  })
  await mcpSession.save(credential)
  notice(ctx, 'MCP do Steel autorizado.')
}

/**
 * `steel mcp`: a stdio MCP server that relays everything to the Steel MCP
 * server (`<profile URL>/api/mcp`, Streamable HTTP) with a bearer token —
 * `--token`/STEEL_MCP_TOKEN as is, or the profile's OAuth credential,
 * refreshed as needed. stdout carries the protocol, so every message to the
 * user goes to stderr.
 */
export async function mcp(ctx: Context, options: McpOptions): Promise<number> {
  const stdio = ctx.deps.stdio
  if (!stdio) {
    throw new CliError('O steel mcp precisa de stdin e stdout.', {
      code: 'MCP_NO_STDIO',
    })
  }
  const target = await ctx.target()
  const token = options.token ?? ctx.env.STEEL_MCP_TOKEN
  const headers: Record<string, string> = {
    'user-agent': `steel-cli/${VERSION} (mcp)`,
  }
  let fetch = ctx.deps.fetch
  let unauthorizedHint = TOKEN_UNAUTHORIZED_HINT
  if (token) {
    headers.authorization = `Bearer ${token}`
  } else {
    const mcpSession = session(ctx, target)
    await ensureCredential(ctx, target, mcpSession, options)
    fetch = mcpSession.fetch
    unauthorizedHint = `Rode \`${loginCommand(target.profileName)}\` num terminal para autorizar de novo.`
  }

  const remote = new StreamableHTTPClientTransport(
    new URL(`${target.url}/api/mcp`),
    { fetch, requestInit: { headers } },
  )
  const local = new StdioServerTransport(stdio.stdin, stdio.stdout)
  // The MCP client ends the session by closing our stdin.
  stdio.stdin.once('end', () => {
    local.close().catch(() => {})
  })

  const end = await runBridge({
    local,
    remote,
    url: target.url,
    signal: ctx.deps.interrupt,
    unauthorizedHint,
    onProblem: (problem) =>
      ctx.printError(
        new CliError(problem.message, {
          hint: problem.hint,
          code: problem.code,
        }),
      ),
  })
  return end === 'aborted' ? EXIT.CANCELLED : EXIT.OK
}

/** `steel mcp login`: browser authorization, tokens saved in the profile. */
export async function mcpLogin(ctx: Context, options: McpLoginOptions) {
  const target = await ctx.target()
  const mcpSession = session(ctx, target)
  const previous = await mcpSession.load()
  const credential = await browserLogin(ctx, target, {
    browser: options.browser,
    requireBrowser: false,
  })
  const storage = await mcpSession.save(credential)
  // The old grant is replaced; revoking it is best effort.
  if (previous) await revokeMcp(previous, ctx.deps.fetch)

  const expiresAt = credential.expiresAt
    ? new Date(credential.expiresAt).toISOString()
    : undefined
  if (ctx.json) {
    ctx.printJson({
      profile: target.profileName,
      url: target.url,
      scope: credential.scope ?? null,
      expiresAt: expiresAt ?? null,
      refreshable: Boolean(credential.refreshToken),
      storage,
    })
    return
  }
  ctx.render(
    <>
      <Success>
        MCP do Steel autorizado no perfil {target.profileName}
        {credential.scope ? ` (${credential.scope})` : ''}.
      </Success>
      <Hint>
        {credential.refreshToken
          ? 'O token renova sozinho. '
          : 'O Steel não enviou refresh token: rode este login de novo quando o token vencer. '}
        Configure o cliente MCP com o comando “steel mcp --profile{' '}
        {target.profileName}”.
      </Hint>
      {storage === 'file' ? (
        <Warning>
          Sem chaveiro do sistema: o token ficou em {ctx.credentialsPath}{' '}
          (permissão 600).
        </Warning>
      ) : null}
      {ctx.env.STEEL_MCP_TOKEN ? (
        <Warning>
          STEEL_MCP_TOKEN está definida e continua valendo no lugar deste login.
        </Warning>
      ) : null}
    </>,
  )
}

/** `steel mcp logout`: revokes on Steel and deletes the stored tokens. */
export async function mcpLogout(ctx: Context) {
  const target = await ctx.target()
  const mcpSession = session(ctx, target)
  const credential = await mcpSession.load()
  const revocation = credential
    ? await revokeMcp(credential, ctx.deps.fetch)
    : undefined
  const removed = await mcpSession.remove()

  if (ctx.json) {
    ctx.printJson({
      profile: target.profileName,
      loggedOut: removed,
      ...(revocation
        ? {
            revoked: revocation.ok,
            ...(revocation.ok ? {} : { revokeError: revocation.reason }),
          }
        : {}),
    })
    return
  }
  ctx.render(
    <>
      {removed ? (
        <Success>Login do MCP removido do perfil {target.profileName}.</Success>
      ) : (
        <Success>
          Nenhum login do MCP salvo no perfil {target.profileName}.
        </Success>
      )}
      {revocation?.ok ? <Success>Acesso revogado no Steel.</Success> : null}
      {revocation && !revocation.ok ? (
        <>
          <Warning>
            {`Não foi possível revogar o acesso no Steel (${revocation.reason}).`}
          </Warning>
          <Hint>
            Revogue em Configurações › Segurança › Apps conectados; o token de
            acesso vence em até 1 hora.
          </Hint>
        </>
      ) : null}
      {ctx.env.STEEL_MCP_TOKEN ? (
        <Warning>STEEL_MCP_TOKEN continua definida neste terminal.</Warning>
      ) : null}
    </>,
  )
}
