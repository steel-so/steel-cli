import { PassThrough } from 'node:stream'
import { renderToString } from 'ink'
import { describe, expect, it } from 'vitest'
import { confirmPrompt } from '../src/lib/confirm.js'
import { ListenStatusLine } from '../src/ui/listen.js'

describe('ListenStatusLine', () => {
  it('shows connecting, reconnecting and the received count', () => {
    expect(
      renderToString(<ListenStatusLine status={{ state: 'connecting' }} />),
    ).toContain('Conectando ao Steel…')
    expect(
      renderToString(
        <ListenStatusLine
          status={{ state: 'reconnecting', inSeconds: 4, reason: 'rede' }}
        />,
      ),
    ).toContain('Conexão perdida (rede). Reconectando em 4 s…')
    expect(
      renderToString(
        <ListenStatusLine status={{ state: 'listening', count: 0 }} />,
      ),
    ).toContain('Aguardando eventos… 0 recebidos · Ctrl+C encerra')
    expect(
      renderToString(
        <ListenStatusLine status={{ state: 'listening', count: 1 }} />,
      ),
    ).toContain('1 recebido ·')
  })
})

describe('confirmPrompt', () => {
  async function answer(text: string) {
    const input = new PassThrough()
    const output = new PassThrough()
    let shown = ''
    output.on('data', (chunk) => {
      shown += String(chunk)
    })
    const pending = confirmPrompt('Remover?', { input, output })
    input.write(`${text}\n`)
    return { accepted: await pending, shown }
  }

  it('accepts s, sim, y and yes, and refuses anything else', async () => {
    for (const yes of ['s', 'SIM', ' y ', 'yes']) {
      expect((await answer(yes)).accepted).toBe(true)
    }
    for (const no of ['', 'n', 'talvez']) {
      expect((await answer(no)).accepted).toBe(false)
    }
    expect((await answer('n')).shown).toContain('Remover? (s/N)')
  })
})
