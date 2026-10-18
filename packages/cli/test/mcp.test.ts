import { PassThrough } from 'node:stream'
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it, vi } from 'vitest'
import { describeRemoteError, runBridge } from '../src/lib/mcp-bridge.js'
import { harness } from './harness.js'

const URL_ = 'https://homologacao.stratustelecom.com.br'

const initialize: JSONRPCMessage = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  },
}

/** client <-> [local | bridge | remote] <-> server, all in memory. */
async function bridged(
  overrides: { failSend?: unknown; signal?: AbortSignal } = {},
) {
  const [client, local] = InMemoryTransport.createLinkedPair()
  const [remoteInner, server] = InMemoryTransport.createLinkedPair()
  const setProtocolVersion = vi.fn()
  const remote = Object.assign(remoteInner, { setProtocolVersion })
  if (overrides.failSend) {
    remote.send = async () => {
      throw overrides.failSend
    }
  }
  const toClient: JSONRPCMessage[] = []
  const toServer: JSONRPCMessage[] = []
  client.onmessage = (message) => toClient.push(message)
  server.onmessage = (message) => toServer.push(message)
  const problems: unknown[] = []
  const done = runBridge({
    local,
    remote,
    url: URL_,
    signal: overrides.signal,
    onProblem: (problem) => problems.push(problem),
  })
  await client.start()
  await server.start()
  return {
    client,
    server,
    local,
    remote,
    toClient,
    toServer,
    problems,
    done,
    setProtocolVersion,
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('runBridge', () => {
  it('relays both ways and adopts the negotiated protocol version', async () => {
    const b = await bridged()
    await b.client.send(initialize)
    await tick()
    expect(b.toServer).toEqual([initialize])

    await b.server.send({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: '2025-06-18', capabilities: {} },
    })
    await b.server.send({ jsonrpc: '2.0', id: 2, result: {} })
    await tick()
    expect(b.toClient).toHaveLength(2)
    expect(b.setProtocolVersion).toHaveBeenCalledTimes(1)
    expect(b.setProtocolVersion).toHaveBeenCalledWith('2025-06-18')

    await b.client.close()
    expect(await b.done).toBe('local-closed')
  })

  it('answers a request locally when Steel cannot be reached', async () => {
    const b = await bridged({ failSend: new StreamableHTTPError(401, 'no') })
    await b.client.send(initialize)
    await b.client.send({ jsonrpc: '2.0', method: 'notifications/x' })
    await tick()
    expect(b.toClient).toEqual([
      {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32000,
          message: expect.stringContaining('O Steel recusou o token do MCP'),
        },
      },
    ])
    expect(b.problems).toHaveLength(2)
    await b.server.close()
    expect(await b.done).toBe('remote-closed')
  })

  it('reports transport errors and stops on abort', async () => {
    const abort = new AbortController()
    const b = await bridged({ signal: abort.signal })
    b.local.onerror?.(new Error('bad json'))
    b.remote.onerror?.(new TypeError('fetch failed'))
    expect(b.problems).toEqual([
      {
        code: 'LOCAL_ERROR',
        message: 'Mensagem inválida do cliente MCP: bad json',
      },
      expect.objectContaining({ code: 'NETWORK_ERROR' }),
    ])
    abort.abort()
    expect(await b.done).toBe('aborted')
  })

  it('ends at once when already aborted', async () => {
    const [, local] = InMemoryTransport.createLinkedPair()
    const [remote] = InMemoryTransport.createLinkedPair()
    expect(
      await runBridge({
        local,
        remote,
        url: URL_,
        signal: AbortSignal.abort(),
      }),
    ).toBe('aborted')
  })

  it('rejects when a transport cannot start', async () => {
    const [, local] = InMemoryTransport.createLinkedPair()
    const [remote] = InMemoryTransport.createLinkedPair()
    remote.start = async () => {
      throw new Error('boom')
    }
    await expect(runBridge({ local, remote, url: URL_ })).rejects.toThrow(
      'boom',
    )
  })
})

describe('describeRemoteError', () => {
  it.each([
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [500, 'REMOTE_ERROR'],
  ])('maps HTTP %i to %s', (status, code) => {
    expect(
      describeRemoteError(new StreamableHTTPError(status, 'x'), URL_).code,
    ).toBe(code)
  })

  it('treats anything else as a network error', () => {
    expect(
      describeRemoteError(new StreamableHTTPError(undefined, 'x'), URL_),
    ).toMatchObject({ message: 'O MCP do Steel respondeu com erro.' })
    expect(describeRemoteError(new Error('x'), URL_)).toMatchObject({
      code: 'NETWORK_ERROR',
      message: `Não foi possível conectar a ${URL_}.`,
    })
  })
})

function stdio() {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let output = ''
  stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  return { stdin, stdout, output: () => output }
}

describe('steel mcp', () => {
  it('needs a token', async () => {
    const h = harness()
    h.deps.stdio = stdio()
    expect(await h.run('mcp')).toBe(3)
    expect(h.errJson().error.code).toBe('MCP_TOKEN_MISSING')
  })

  it('needs stdio', async () => {
    const h = harness({ env: { STEEL_MCP_TOKEN: 't' } })
    expect(await h.run('mcp')).toBe(1)
    expect(h.errJson().error.code).toBe('MCP_NO_STDIO')
  })

  it('bridges stdio to <profile>/api/mcp with the bearer token', async () => {
    const h = harness({ env: { STEEL_MCP_TOKEN: 'mcp_env' } })
    const io = stdio()
    h.deps.stdio = io
    h.reply(
      () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { protocolVersion: '2025-06-18', capabilities: {} },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )

    const run = h.run('mcp', '--token', 'mcp_flag')
    io.stdin.write(`${JSON.stringify(initialize)}\n`)
    await vi.waitFor(() => expect(io.output()).toContain('protocolVersion'))
    io.stdin.end()

    expect(await run).toBe(0)
    const request = h.requests[0]
    expect(request?.url).toBe(`${URL_}/api/mcp`)
    expect(request?.method).toBe('POST')
    expect(request?.headers.get('authorization')).toBe('Bearer mcp_flag')
    expect(request?.headers.get('user-agent')).toMatch(
      /^steel-cli\/.+ \(mcp\)$/,
    )
    expect(JSON.parse(io.output())).toMatchObject({ id: 1 })
  })

  it('logs Steel refusals on stderr and answers the client', async () => {
    const h = harness({ env: { STEEL_MCP_TOKEN: 'bad' } })
    const io = stdio()
    h.deps.stdio = io
    h.reply(new Response('unauthorized', { status: 401 }))

    const run = h.run('mcp')
    io.stdin.write(`${JSON.stringify(initialize)}\n`)
    await vi.waitFor(() => expect(io.output()).toContain('error'))
    io.stdin.end()

    expect(await run).toBe(0)
    expect(JSON.parse(io.output()).error.code).toBe(-32000)
    expect(h.errJson().error.code).toBe('UNAUTHORIZED')
  })

  it('exits 130 on Ctrl+C', async () => {
    const abort = new AbortController()
    const h = harness({
      env: { STEEL_MCP_TOKEN: 't' },
      interrupt: abort.signal,
    })
    h.deps.stdio = stdio()
    const run = h.run('mcp')
    await tick()
    abort.abort()
    expect(await run).toBe(130)
  })
})
