import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { Terminal } from '../src/context.js'
import { page, ticket } from './domain-fixtures.js'
import { FakeStream, fail, harness, me, ok } from './harness.js'
import { tick, waitFor } from './tui-fixtures.js'

/** Just enough of a TTY stdin for Ink's raw-mode input. */
class FakeStdin extends EventEmitter {
  isTTY = true
  private data: string | null = null
  write(data: string) {
    this.data = data
    this.emit('readable')
    this.emit('data', data)
  }
  read() {
    const { data } = this
    this.data = null
    return data
  }
  setEncoding() {}
  setRawMode() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
}

async function withTerminal() {
  const h = harness({ tty: true, live: true })
  await h.keychain?.set('homologacao', 'stl_pat_saved')
  const stdin = new FakeStdin()
  const screen = new FakeStream(true)
  h.deps.terminal = {
    stdin,
    stdout: screen,
    stderr: new FakeStream(true),
  } as unknown as Terminal
  return { h, stdin, screen }
}

const meAll = {
  ...me,
  modules: ['SERVICE_DESK', 'CRM', 'COMMUNICATION'],
}

describe('steel with no arguments', () => {
  it('opens the dashboard on a terminal and quits with q', async () => {
    const { h, stdin, screen } = await withTerminal()
    h.reply(ok(meAll), ok(page([ticket()])))
    const exit = h.run()
    await waitFor(() => expect(screen.output).toContain('INC-42'))
    expect(screen.output).toContain('Ana Souza')
    expect(screen.output).toContain('homologacao')
    // Full screen: the alternate buffer is switched on.
    expect(screen.output).toContain('\u001B[?1049h')
    await tick()
    stdin.write('q')
    expect(await exit).toBe(0)
    expect(h.requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/api/v1/me',
      '/api/v1/servicedesk/tickets',
    ])
    expect(h.out()).toBe('')
  })

  it('honors --profile and quits with Esc', async () => {
    const { h, stdin, screen } = await withTerminal()
    h.reply(ok(meAll), ok(page([])))
    const exit = h.run('--profile', 'homologacao', '--no-color')
    await waitFor(() => expect(screen.output).toContain('Fila limpa'))
    await tick()
    stdin.write('\u001B')
    expect(await exit).toBe(0)
  })

  it('prints the login hint before opening the screen on 401', async () => {
    const { h, screen } = await withTerminal()
    h.reply(fail(401, 'UNAUTHORIZED'))
    expect(await h.run()).toBe(3)
    expect(h.err()).toContain('Token inválido, expirado ou revogado.')
    expect(h.err()).toContain('Rode `steel login`')
    expect(screen.output).toBe('')
  })

  it('asks to log in when there is no token', async () => {
    const { h } = await withTerminal()
    await h.keychain?.delete('homologacao')
    expect(await h.run()).toBe(3)
    expect(h.err()).toContain(
      'Você não está conectado no perfil “homologacao”.',
    )
  })

  it('prints the help outside a terminal, even with --profile', async () => {
    const h = harness()
    expect(await h.run('--profile', 'homologacao')).toBe(0)
    expect(h.out()).toContain('Uso: steel [opções] [comando]')
    expect(h.fetch).not.toHaveBeenCalled()
  })
})
