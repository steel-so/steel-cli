import { PassThrough } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { Context } from '../src/context.js'
import { parseEnum, required, sameText, truncate } from '../src/lib/domain.js'
import { readlinePrompter } from '../src/lib/prompt.js'
import { formatMinutes, progressBar } from '../src/ui/labels.js'
import { harness } from './harness.js'

/** A prompter fed by `lines`, one per question, with its output. */
function scripted(lines: string[], signal?: AbortSignal) {
  const input = new PassThrough()
  const output = new PassThrough()
  let text = ''
  output.on('data', (chunk) => {
    text += chunk.toString()
    // Answer each question as soon as it is asked.
    if (/ $/.test(text) && lines.length > 0) {
      input.write(`${lines.shift()}\n`)
    }
  })
  return {
    prompt: readlinePrompter(input, output, signal),
    output: () => stripVTControlCharacters(text),
  }
}

describe('readlinePrompter', () => {
  it('asks text with defaults and retries required answers', async () => {
    const s = scripted(['', '  Ana  ', '', ''])

    expect(await s.prompt.text('Nome', { required: true })).toBe('Ana')
    expect(await s.prompt.text('Origem', { default: 'CLI' })).toBe('CLI')
    expect(await s.prompt.text('Opcional')).toBe('')
    expect(s.output()).toContain('Resposta obrigatória.')
    expect(s.output()).toContain('Origem (CLI)')
  })

  it('selects by number and retries invalid picks', async () => {
    const s = scripted(['9', 'x', '2'])

    const value = await s.prompt.select('Tipo', [
      { value: 'a', label: 'Primeiro' },
      { value: 'b', label: 'Segundo', hint: 'dica' },
    ])

    expect(value).toBe('b')
    expect(s.output()).toContain(' 2) Segundo  dica')
    expect(s.output()).toContain('Digite um número da lista.')
  })

  it('confirms with sim/não and the default', async () => {
    const s = scripted(['talvez', 'sim', 'n', ''])

    expect(await s.prompt.confirm('Continuar?')).toBe(true)
    expect(await s.prompt.confirm('Apagar?', false)).toBe(false)
    expect(await s.prompt.confirm('De novo?', false)).toBe(false)
    expect(s.output()).toContain('(S/n)')
    expect(s.output()).toContain('(s/N)')
  })

  it('turns Ctrl+C into a cancellation', async () => {
    const controller = new AbortController()
    const s = scripted([], controller.signal)
    const pending = s.prompt.text('Nome')
    controller.abort()
    await expect(pending).rejects.toMatchObject({
      code: 'CANCELLED',
      exitCode: 130,
    })
    await expect(s.prompt.confirm('Outra?')).rejects.toMatchObject({
      code: 'CANCELLED',
    })
  })
})

describe('domain helpers', () => {
  it('only prompts on an interactive context', async () => {
    const h = harness({ tty: true })
    const ctx = new Context(h.deps, {})
    expect(ctx.interactive).toBe(false)
    expect(() => ctx.prompt).toThrow('outside a terminal')
    await expect(
      required(ctx, undefined, '--x', async () => 'never'),
    ).rejects.toMatchObject({ message: 'Falta --x.', exitCode: 2 })
    expect(await required(ctx, 'v', '--x', async () => 'never')).toBe('v')

    h.deps.prompt = {
      text: async () => 'asked',
      select: async () => 'x' as never,
      confirm: async () => true,
    }
    const json = new Context(h.deps, { json: true })
    expect(json.interactive).toBe(false)
    expect(new Context(h.deps, {}).interactive).toBe(true)
  })

  it('maps enum aliases ignoring case, accents and separators', () => {
    const aliases = { SERVICE_REQUEST: ['requisição'], CHANGE: [] }
    expect(
      parseEnum(['Requisicao,service-request', 'change'], aliases, '--t'),
    ).toEqual(['SERVICE_REQUEST', 'SERVICE_REQUEST', 'CHANGE'])
    expect(parseEnum([' , '], aliases, '--t')).toBeUndefined()
    expect(sameText('Renovação', 'renovacao')).toBe(true)
  })

  it('formats text, minutes and progress', () => {
    expect(truncate('a  b\nc', 10)).toBe('a b c')
    expect(truncate('abcdef', 4)).toBe('abc…')
    expect(formatMinutes(45)).toBe('45 min')
    expect(formatMinutes(3000)).toBe('2 d')
    expect(formatMinutes(-120)).toBe('2 h atrás')
    expect(progressBar(5, 10, 4)).toBe('██░░ 50%')
    expect(progressBar(20, 10, 2)).toBe('██ 100%')
  })
})
