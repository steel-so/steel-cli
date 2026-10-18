/**
 * Minimal Server-Sent Events parser (WHATWG HTML §9.2.6) over a fetch body:
 * `event`, `data` (multi-line joined with `\n`), `id` and `retry` fields,
 * comment lines ignored, a message dispatched on each blank line.
 */

export interface SseMessage {
  /** `message` when the server sent no `event:` field. */
  event: string
  data: string
  id?: string
  retry?: number
}

interface Pending {
  event: string
  data: string[]
  hasData: boolean
  id?: string
  retry?: number
}

const empty = (): Pending => ({ event: '', data: [], hasData: false })

export async function* parseSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseMessage> {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  let buffer = ''
  let pending = empty()
  let lastId: string | undefined

  const take = (line: string): SseMessage | undefined => {
    if (line === '') {
      const done = pending
      pending = empty()
      if (!done.hasData) return undefined
      if (done.id !== undefined) lastId = done.id
      const message: SseMessage = {
        event: done.event || 'message',
        data: done.data.join('\n'),
      }
      if (lastId !== undefined) message.id = lastId
      if (done.retry !== undefined) message.retry = done.retry
      return message
    }
    if (line.startsWith(':')) return undefined
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    switch (field) {
      case 'event':
        pending.event = value
        break
      case 'data':
        pending.data.push(value)
        pending.hasData = true
        break
      case 'id':
        if (!value.includes('\0')) pending.id = value
        break
      case 'retry':
        if (/^\d+$/.test(value)) pending.retry = Number(value)
        break
    }
    return undefined
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true })
      // Keep a trailing `\r` in the buffer: it may be the start of `\r\n`.
      const lines = buffer.split(/\r\n|\n|\r(?!$)/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const message = take(line)
        if (message) yield message
      }
      if (done) return
    }
  } finally {
    // Also closes the connection when the consumer stops early.
    await reader.cancel().catch(() => undefined)
  }
}
