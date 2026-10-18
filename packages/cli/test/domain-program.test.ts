import { describe, expect, it } from 'vitest'
import { harness } from './harness.js'

describe('domain command tree', () => {
  it('lists the module commands in the root help', async () => {
    const h = harness()
    await h.run('--help')
    for (const command of ['sd', 'crm', 'zap']) {
      expect(h.out()).toMatch(new RegExp(`\\n  ${command} +\\S`))
    }
  })

  it('documents the list, write and send flags in pt-BR', async () => {
    const list = harness()
    expect(await list.run('sd', 'ticket', 'list', '--help')).toBe(0)
    expect(list.out()).toContain('--status <status>')
    expect(list.out()).toContain('--all')
    expect(list.out()).toContain('steel sd ticket list --assignee me')

    const send = harness()
    await send.run('zap', 'send', '--help')
    expect(send.out()).toContain('-y, --yes')
    expect(send.out()).toContain('--var <chave=valor>')
  })

  it('completes the nested commands', async () => {
    const h = harness()
    await h.run('completion', 'bash')
    expect(h.out()).toContain('sd ticket')
    expect(h.out()).toContain('zap broadcast')
  })

  it('suggests a close subcommand', async () => {
    const h = harness()
    expect(await h.run('sd', 'tiket')).toBe(2)
    expect(h.errJson().error.hint).toContain('ticket')
  })
})
