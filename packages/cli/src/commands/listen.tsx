import {
  type ListenMessage,
  type SteelError,
  verifySignature,
} from '@steel-so/sdk'
import type { AuthTarget, Context } from '../context.js'
import { CliError, EXIT, fromSteelError } from '../errors.js'
import { forwardFrame, normalizeForwardUrl } from '../lib/forward.js'
import { abortableSleep, reconnectDelayMs } from '../lib/sleep.js'
import {
  ListenApp,
  type ListenEventItem,
  type ListenItem,
  ListenItemView,
  type ListenStatus,
} from '../ui/listen.js'

export interface ListenOptions {
  events?: string
  forward?: string
  print?: boolean
}

interface ListenView {
  push(item: ListenItem): void
  status(status: ListenStatus): void
  close(): void
}

/** `--events a,b c` → unique, trimmed types. */
export function parseEventList(input?: string): string[] {
  const parts = (input ?? '')
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '' && part !== '*')
  return Array.from(new Set(parts))
}

/** Codes that reconnecting cannot fix. */
function isFatal(error: SteelError): boolean {
  return [400, 401, 403, 404, 422].includes(error.status)
}

function listenError(error: SteelError, target: AuthTarget): CliError {
  if (error.code === 'VALIDATION_ERROR') {
    return new CliError('Algum tipo em --events não existe no catálogo.', {
      code: error.code,
      exitCode: EXIT.USAGE,
      hint: 'Veja os tipos com `steel webhooks events`.',
      cause: error,
    })
  }
  if (error.code === 'FORBIDDEN') {
    return new CliError(
      error.message ?? 'Sem permissão para escutar os eventos.',
      {
        code: error.code,
        exitCode: EXIT.AUTH,
        hint: 'O `steel listen` é para OWNER/ADMIN do workspace; confira o token com `steel whoami`.',
        cause: error,
      },
    )
  }
  return fromSteelError(error, target.url)
}

function reasonLabel(
  message: ListenMessage & { type: 'disconnected' },
): string {
  if (message.reason === 'idle') return 'sem sinal do servidor'
  if (message.reason === 'network') return 'rede'
  return 'o servidor encerrou'
}

function errorLabel(error: SteelError): string {
  if (error.code === 'NETWORK_ERROR') return 'sem conexão'
  if (error.code === 'TIMEOUT') return 'tempo esgotado'
  if (error.code === 'RATE_LIMITED') return 'limite de requisições'
  return `HTTP ${error.status}`
}

async function createView(ctx: Context): Promise<ListenView> {
  const timeZone = ctx.deps.timeZone
  if (ctx.json) {
    return {
      push(item) {
        if (item.kind === 'notice') return
        if (item.kind === 'header') {
          ctx.io.stdout.write(
            `${JSON.stringify({
              type: 'ready',
              profile: item.profileName,
              url: item.url,
              events: item.events,
              forward: item.forwardUrl ?? null,
              secret: item.secret,
            })}\n`,
          )
          return
        }
        let body: unknown = item.body
        try {
          body = JSON.parse(item.body ?? '')
        } catch {}
        ctx.io.stdout.write(
          `${JSON.stringify({
            type: 'webhook',
            id: item.id,
            eventType: item.type,
            at: item.at,
            verified: item.verified,
            body,
            forward: item.forward ?? null,
          })}\n`,
        )
      },
      status(status) {
        if (status.state === 'reconnecting') {
          ctx.io.stderr.write(`${JSON.stringify({ status })}\n`)
        }
      },
      close() {},
    }
  }

  if (ctx.live) {
    const { render } = await import('ink')
    const items: ListenItem[] = []
    let current: ListenStatus = { state: 'connecting' }
    const node = () => (
      <ListenApp items={[...items]} status={current} timeZone={timeZone} />
    )
    const instance = render(node(), {
      stdout: ctx.io.stdout as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    return {
      push(item) {
        items.push(item)
        instance.rerender(node())
      },
      status(status) {
        current = status
        instance.rerender(node())
      },
      close() {
        instance.clear()
        instance.unmount()
      },
    }
  }

  return {
    push(item) {
      ctx.render(<ListenItemView item={item} timeZone={timeZone} />)
    },
    status(status) {
      if (status.state === 'reconnecting') {
        ctx.render(
          <ListenItemView
            item={{
              kind: 'notice',
              tone: 'warning',
              text: `Conexão perdida (${status.reason}). Reconectando em ${status.inSeconds} s…`,
            }}
          />,
          ctx.io.stderr,
        )
      }
    },
    close() {},
  }
}

export async function listen(ctx: Context, options: ListenOptions) {
  const events = parseEventList(options.events)
  const forwardUrl =
    options.forward === undefined
      ? undefined
      : normalizeForwardUrl(options.forward)
  const target = await ctx.authTarget()
  const client = ctx.client(target, target.token)
  const signal = ctx.deps.interrupt
  const sleep = ctx.deps.sleep ?? abortableSleep
  const workspace =
    target.profile.session?.workspace?.name ??
    target.profile.session?.workspace?.slug

  const view = await createView(ctx)
  let attempt = 0
  let received = 0
  let connectedOnce = false
  let secret = ''

  const waitAndRetry = async (reason: string, retryAfterSeconds?: number) => {
    const delay = retryAfterSeconds
      ? retryAfterSeconds * 1000
      : reconnectDelayMs(attempt)
    attempt += 1
    view.status({
      state: 'reconnecting',
      inSeconds: Math.round(delay / 1000),
      reason,
    })
    await sleep(delay, signal)
  }

  try {
    view.status({ state: 'connecting' })
    while (!signal?.aborted) {
      const opened = await client.webhooks.listen({ events, signal })
      if (!opened.ok) {
        if (signal?.aborted) break
        if (isFatal(opened.error)) throw listenError(opened.error, target)
        await waitAndRetry(
          errorLabel(opened.error),
          opened.error.retryAfterSeconds,
        )
        continue
      }

      for await (const message of opened.data) {
        if (message.type === 'ready') {
          attempt = 0
          secret = message.ready.secret
          if (connectedOnce) {
            view.push({ kind: 'notice', tone: 'success', text: 'Reconectado.' })
          } else {
            connectedOnce = true
            view.push({
              kind: 'header',
              workspace: workspace ?? message.ready.workspaceId,
              profileName: target.profileName,
              url: target.url,
              events: message.ready.events,
              forwardUrl,
              secret,
            })
          }
          view.status({ state: 'listening', count: received })
        } else if (message.type === 'webhook') {
          const { frame, event } = message
          received += 1
          const item: ListenEventItem = {
            kind: 'event',
            id: frame.id,
            type: typeof event?.type === 'string' ? event.type : '?',
            at:
              typeof event?.createdAt === 'string'
                ? event.createdAt
                : new Date().toISOString(),
            verified: verifySignature(
              secret,
              frame.signature,
              frame.timestamp,
              frame.body,
              { toleranceSeconds: 0 },
            ),
          }
          if (options.print || ctx.json) item.body = frame.body
          if (forwardUrl) {
            item.forward = await forwardFrame(ctx.deps.fetch, forwardUrl, frame)
          }
          view.push(item)
          view.status({ state: 'listening', count: received })
        } else {
          if (signal?.aborted) break
          await waitAndRetry(reasonLabel(message))
        }
      }
    }
  } finally {
    view.close()
  }

  if (!ctx.json) {
    ctx.render(
      <ListenItemView
        item={{
          kind: 'notice',
          tone: 'success',
          text: `Escuta encerrada. ${received === 1 ? '1 evento recebido' : `${received} eventos recebidos`}.`,
        }}
      />,
      ctx.io.stderr,
    )
  }
  return EXIT.OK
}
