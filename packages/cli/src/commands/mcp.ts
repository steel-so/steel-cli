import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Context } from '../context.js'
import { CliError, EXIT } from '../errors.js'
import { runBridge } from '../lib/mcp-bridge.js'
import { VERSION } from '../version.js'

export interface McpOptions {
  token?: string
}

/**
 * `steel mcp`: a stdio MCP server that relays everything to the Steel MCP
 * server (`<profile URL>/api/mcp`, Streamable HTTP) with a bearer token.
 * stdout carries the protocol, so every message to the user goes to stderr.
 */
export async function mcp(ctx: Context, options: McpOptions): Promise<number> {
  const token = options.token ?? ctx.env.STEEL_MCP_TOKEN
  if (!token) {
    throw new CliError('Falta o token do MCP do Steel.', {
      hint: 'Passe --token <token> ou defina STEEL_MCP_TOKEN com um token de acesso OAuth do MCP do Steel.',
      code: 'MCP_TOKEN_MISSING',
      exitCode: EXIT.AUTH,
    })
  }
  const stdio = ctx.deps.stdio
  if (!stdio) {
    throw new CliError('O steel mcp precisa de stdin e stdout.', {
      code: 'MCP_NO_STDIO',
    })
  }
  const target = await ctx.target()

  const remote = new StreamableHTTPClientTransport(
    new URL(`${target.url}/api/mcp`),
    {
      fetch: ctx.deps.fetch,
      requestInit: {
        headers: {
          authorization: `Bearer ${token}`,
          'user-agent': `steel-cli/${VERSION} (mcp)`,
        },
      },
    },
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
