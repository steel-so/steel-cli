import { describe, expect, it } from 'vitest'
import { parseSse, type SseMessage } from '../src/index.js'

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function collect(chunks: string[]): Promise<SseMessage[]> {
  const out: SseMessage[] = []
  for await (const message of parseSse(stream(chunks))) out.push(message)
  return out
}

describe('parseSse', () => {
  it('parses named events, ids and comments', async () => {
    expect(
      await collect([
        'event: ready\ndata: {"a":1}\n\n',
        ': ping\n\n',
        'event: webhook\nid: evt_1\ndata: {"b":2}\n\n',
      ]),
    ).toEqual([
      { event: 'ready', data: '{"a":1}' },
      { event: 'webhook', data: '{"b":2}', id: 'evt_1' },
    ])
  })

  it('reassembles fields split across chunks, CRLF and CR line ends', async () => {
    expect(
      await collect(['da', 'ta: one\r', '\ndata:two\r\r', 'data: x\n', '\n']),
    ).toEqual([
      { event: 'message', data: 'one\ntwo' },
      { event: 'message', data: 'x' },
    ])
  })

  it('keeps the last id, reads retry and ignores unknown fields', async () => {
    expect(
      await collect([
        'id: 7\nretry: 3000\nfoo: bar\ndata\n\n',
        'retry: soon\nid: a\0b\ndata: y\n\n',
      ]),
    ).toEqual([
      { event: 'message', data: '', id: '7', retry: 3000 },
      { event: 'message', data: 'y', id: '7' },
    ])
  })

  it('drops a block without data and an unterminated last message', async () => {
    expect(await collect(['event: lonely\n\n', 'data: cut'])).toEqual([])
  })

  it('cancels the stream when the consumer stops early', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: 1\n\ndata: 2\n\n'))
      },
      cancel() {
        cancelled = true
      },
    })
    for await (const message of parseSse(body)) {
      expect(message.data).toBe('1')
      break
    }
    expect(cancelled).toBe(true)
  })
})
