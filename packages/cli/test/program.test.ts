import { execFileSync, spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { completionScript } from '../src/commands/completion.js'
import { buildProgram } from '../src/program.js'
import { VERSION } from '../src/version.js'
import { harness } from './harness.js'

function hasShell(shell: string): boolean {
  return spawnSync(shell, ['-c', 'exit 0']).status === 0
}

describe('program', () => {
  it('prints the pt-BR help with no arguments and with --help', async () => {
    const h = harness()
    expect(await h.run()).toBe(0)
    expect(h.out()).toContain('Uso: steel [opções] [comando]')
    expect(h.out()).toContain('Comandos:')
    expect(h.out()).toContain('login [opções]')
    expect(h.out()).not.toContain('__complete')

    const sub = harness()
    expect(await sub.run('profile', 'add', '--help')).toBe(0)
    expect(sub.out()).toContain('Opções globais:')
    expect(sub.out()).toContain('Argumentos:')
  })

  it('prints the version', async () => {
    const h = harness()
    expect(await h.run('--version')).toBe(0)
    expect(h.out()).toBe(`steel ${VERSION} (dev)\n`)
  })

  it.each([
    [['wohami'], 'Comando desconhecido: wohami', 'Você quis dizer whoami?'],
    [['whoami', '--nope'], 'Opção desconhecida: --nope', '--help'],
    [['profile', 'use'], 'Falta o argumento nome.', '--help'],
    [['--profile'], 'A opção --profile <nome> precisa de um valor.', '--help'],
    [
      ['profile', 'add', 'x'],
      'A opção --url <url> precisa de um valor.',
      '--help',
    ],
    [['logout', 'extra'], 'Argumentos demais.', '--help'],
  ])('translates commander errors for %j', async (argv, message, hint) => {
    const h = harness()
    expect(await h.run(...argv)).toBe(2)
    const { error } = h.errJson()
    expect(error.message).toBe(message)
    expect(error.hint).toContain(hint)
  })

  it('reports unexpected errors as INTERNAL', async () => {
    const h = harness()
    h.deps.hostname = () => {
      throw new Error('kaboom')
    }
    await h.keychain?.set('homologacao', 'x')
    expect(await h.run('login')).toBe(1)
    expect(h.errJson().error).toMatchObject({
      code: 'INTERNAL',
      message: 'Erro inesperado no Steel CLI.',
    })
  })
})

describe('steel completion', () => {
  it.each(['bash', 'zsh', 'fish'])(
    'prints a %s script with every command',
    async (shell) => {
      const h = harness()
      expect(await h.run('completion', shell)).toBe(0)
      const script = h.out()
      for (const word of [
        'login',
        'logout',
        'whoami',
        'profile',
        'api',
        'completion',
      ]) {
        expect(script).toContain(word)
      }
      expect(script).toContain('steel __complete profiles')
      expect(script).not.toContain('__complete"')
    },
  )

  it('refuses an unknown shell', async () => {
    const h = harness()
    expect(await h.run('completion', 'powershell')).toBe(2)
    expect(h.errJson().error.message).toBe('Shell não suportado: powershell')
  })

  it.each(['bash', 'zsh', 'fish'])('the %s script parses', (shell) => {
    if (!hasShell(shell)) return
    const h = harness()
    const script = completionScript(
      buildProgram(h.deps, { exitCode: 0 }),
      shell,
    )
    const args = shell === 'fish' ? ['--no-execute'] : ['-n']
    expect(() =>
      execFileSync(shell, args, {
        input: script,
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    ).not.toThrow()
  })

  it('completes subcommands and profiles in bash', () => {
    if (!hasShell('bash')) return
    const h = harness()
    const script = completionScript(
      buildProgram(h.deps, { exitCode: 0 }),
      'bash',
    )
    const complete = (line: string) =>
      execFileSync(
        'bash',
        [
          '-c',
          `${script}
steel() { printf 'homologacao\\nproducao\\n'; }
COMP_WORDS=(${line}); COMP_CWORD=$((\${#COMP_WORDS[@]} - 1))
_steel_completion; printf '%s\\n' "\${COMPREPLY[@]}"`,
        ],
        { encoding: 'utf8' },
      )
        .trim()
        .split('\n')
    expect(complete("steel ''")).toEqual(
      expect.arrayContaining(['login', 'profile', 'api', '--json']),
    )
    expect(complete('steel profile u')).toEqual(['use'])
    expect(complete("steel profile use ''")).toEqual(
      expect.arrayContaining(['homologacao', 'producao']),
    )
    expect(complete('steel --profile h')).toEqual(['homologacao'])
    expect(complete('steel api P')).toEqual(['POST', 'PUT', 'PATCH'])
    expect(complete('steel api GET /me --j')).toEqual(['--json'])
  })
})
