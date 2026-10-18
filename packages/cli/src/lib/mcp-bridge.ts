import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  ErrorCode,
  isInitializeRequest,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  type JSONRPCMessage,
  type RequestId,
} from '@modelcontextprotocol/sdk/types.js'
import { McpLoginRequiredError } from './mcp-oauth.js'

/** A transport that can be told the negotiated protocol version. */
export type RemoteTransport = Transport & {
  setProtocolVersion?: (version: string) => void
}

export interface BridgeOptions {
  /** Towards the MCP client (stdio). */
  local: Transport
  /** Towards the Steel MCP server (Streamable HTTP). */
  remote: RemoteTransport
  /** Base URL of the remote, for error messages. */
  url: string
  /** Problems worth telling the user about (written to stderr). */
  onProblem?: (problem: BridgeProblem) => void
  /** Closes both sides when aborted (Ctrl+C). */
  signal?: AbortSignal
  /** What to do about a 401; depends on where the token came from. */
  unauthorizedHint?: string
}

export interface BridgeProblem {
  code: string
  message: string
  hint?: string
}

export type BridgeEnd = 'local-closed' | 'remote-closed' | 'aborted'

export const TOKEN_UNAUTHORIZED_HINT =
  'Confira --token ou STEEL_MCP_TOKEN: o token pode ter expirado ou sido revogado em Apps conectados.'

/** Turns a failure talking to Steel into what the user (and the AI) reads. */
export function describeRemoteError(
  error: unknown,
  url: string,
  unauthorizedHint: string = TOKEN_UNAUTHORIZED_HINT,
): BridgeProblem {
  if (error instanceof McpLoginRequiredError) {
    return {
      code: 'MCP_LOGIN_REQUIRED',
      message:
        error.reason === 'missing'
          ? 'Não há login do MCP do Steel neste perfil.'
          : 'O login do MCP do Steel expirou ou foi revogado.',
      hint: unauthorizedHint,
    }
  }
  if (error instanceof StreamableHTTPError) {
    switch (error.code) {
      case 401:
        return {
          code: 'UNAUTHORIZED',
          message: 'O Steel recusou o token do MCP (401).',
          hint: unauthorizedHint,
        }
      case 403:
        return {
          code: 'FORBIDDEN',
          message:
            'O token do MCP não tem permissão para isso (403): confira o escopo e os módulos concedidos.',
        }
      case 404:
        return {
          code: 'NOT_FOUND',
          message: `Não há servidor MCP em ${url} (404).`,
          hint: 'Confira a URL do perfil com `steel profile list`.',
        }
      case 429:
        return {
          code: 'RATE_LIMITED',
          message:
            'Muitas requisições ao MCP do Steel (429). Tente de novo em instantes.',
        }
      default:
        return {
          code: 'REMOTE_ERROR',
          message: `O MCP do Steel respondeu ${error.code ?? 'com erro'}.`,
        }
    }
  }
  return {
    code: 'NETWORK_ERROR',
    message: `Não foi possível conectar a ${url}.`,
    hint: 'Confira a sua conexão e a URL do perfil (`steel profile list`).',
  }
}

/**
 * Relays JSON-RPC messages between a local MCP client and the remote Steel
 * MCP server, unchanged, in both directions. A request that cannot reach
 * Steel is answered locally with a JSON-RPC error, so the client never waits
 * forever. Resolves when either side closes or the signal aborts.
 */
export function runBridge(options: BridgeOptions): Promise<BridgeEnd> {
  const { local, remote, url, onProblem, signal, unauthorizedHint } = options
  const describe = (error: unknown) =>
    describeRemoteError(error, url, unauthorizedHint)
  const pendingInitialize = new Set<RequestId>()
  let finished = false

  return new Promise<BridgeEnd>((resolve, reject) => {
    const finish = (end: BridgeEnd) => {
      if (finished) return
      finished = true
      signal?.removeEventListener('abort', onAbort)
      // Each close fires the other side's onclose; `finished` stops the loop.
      Promise.allSettled([local.close(), remote.close()]).then(() =>
        resolve(end),
      )
    }
    const onAbort = () => finish('aborted')

    local.onmessage = (message: JSONRPCMessage) => {
      if (isInitializeRequest(message) && isJSONRPCRequest(message)) {
        pendingInitialize.add(message.id)
      }
      remote.send(message).catch((error: unknown) => {
        const problem = describe(error)
        onProblem?.(problem)
        if (!isJSONRPCRequest(message)) return
        pendingInitialize.delete(message.id)
        local
          .send({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: ErrorCode.ConnectionClosed,
              message: problem.hint
                ? `${problem.message} ${problem.hint}`
                : problem.message,
            },
          })
          .catch(() => {})
      })
    }

    remote.onmessage = (message: JSONRPCMessage) => {
      if (
        isJSONRPCResultResponse(message) &&
        pendingInitialize.delete(message.id)
      ) {
        const version = (message.result as { protocolVersion?: unknown })
          .protocolVersion
        if (typeof version === 'string') remote.setProtocolVersion?.(version)
      }
      local.send(message).catch(() => {})
    }

    local.onerror = (error) =>
      onProblem?.({
        code: 'LOCAL_ERROR',
        message: `Mensagem inválida do cliente MCP: ${error.message}`,
      })
    remote.onerror = (error) => onProblem?.(describe(error))
    local.onclose = () => finish('local-closed')
    remote.onclose = () => finish('remote-closed')

    if (signal?.aborted) {
      finish('aborted')
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    Promise.all([remote.start(), local.start()]).catch((error: unknown) => {
      if (finished) return
      finished = true
      reject(error)
    })
  })
}
