import { type Command, Help } from 'commander'
import { usageError } from '../errors.js'
import { API_METHODS } from './api.js'

export const SHELLS = ['bash', 'zsh', 'fish'] as const
export type Shell = (typeof SHELLS)[number]

interface OptionSpec {
  short?: string
  long?: string
  description: string
  takesValue: boolean
}

export interface CommandSpec {
  /** Space-separated path from the root, `''` for `steel` itself. */
  path: string
  name: string
  description: string
  options: OptionSpec[]
  subcommands: CommandSpec[]
}

const PROFILES = '$(steel __complete profiles 2>/dev/null)'

/** Static values for the first positional argument of a command. */
const POSITIONAL_VALUES: Record<string, readonly string[] | 'profiles'> = {
  api: API_METHODS,
  completion: SHELLS,
  'profile use': 'profiles',
}

const help = new Help()

function optionSpecs(command: Command): OptionSpec[] {
  return help.visibleOptions(command).map((option) => ({
    short: option.short,
    long: option.long,
    description: option.description,
    takesValue: option.required || option.optional,
  }))
}

/** Walks the commander tree; `path` is `''` for the root. */
export function specFromCommand(
  command: Command,
  parentPath?: string,
): CommandSpec {
  const path =
    parentPath === undefined
      ? ''
      : [parentPath, command.name()].filter(Boolean).join(' ')
  return {
    path,
    name: command.name(),
    description: command.description(),
    options: optionSpecs(command),
    subcommands: help
      .visibleCommands(command)
      .filter((sub) => sub.name() !== 'help')
      .map((sub) => specFromCommand(sub, path)),
  }
}

function flatten(spec: CommandSpec): CommandSpec[] {
  return [spec, ...spec.subcommands.flatMap(flatten)]
}

function flags(option: OptionSpec): string[] {
  return [option.short, option.long].filter(
    (flag): flag is string => typeof flag === 'string',
  )
}

function valueFlags(specs: CommandSpec[]): string[] {
  const set = new Set<string>()
  for (const spec of specs) {
    for (const option of spec.options) {
      if (!option.takesValue) continue
      for (const flag of flags(option)) set.add(flag)
    }
  }
  return [...set].sort()
}

/** Deepest paths first, so `profile use` wins over `profile`. */
function byDepth(specs: CommandSpec[]): CommandSpec[] {
  return [...specs].sort(
    (a, b) => b.path.split(' ').length - a.path.split(' ').length,
  )
}

function quoteSingle(text: string): string {
  return text.replace(/'/g, `'\\''`)
}

export function bashScript(root: CommandSpec, globals: OptionSpec[]): string {
  const all = flatten(root)
  const values = valueFlags([...all, { ...root, options: globals }])
  const globalFlags = globals.flatMap(flags)
  const cases: string[] = []
  for (const spec of byDepth(all.filter((s) => s.path))) {
    const optionWords = [...spec.options.flatMap(flags), ...globalFlags]
    const positional = POSITIONAL_VALUES[spec.path]
    const exact = [
      ...spec.subcommands.map((sub) => sub.name),
      ...(positional === 'profiles' ? [PROFILES] : (positional ?? [])),
      ...optionWords,
    ]
    cases.push(`    "${spec.path}") words="${exact.join(' ')}" ;;`)
    cases.push(`    "${spec.path} "*) words="${optionWords.join(' ')}" ;;`)
  }
  const rootWords = [
    ...root.subcommands.map((sub) => sub.name),
    ...root.options.flatMap(flags),
  ]
  return `# Steel CLI: autocomplete para bash.
# Instale com: steel completion bash > ~/.local/share/bash-completion/completions/steel
_steel_completion() {
  local cur prev word path="" words="" skip=0 i
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  for ((i = 1; i < COMP_CWORD; i++)); do
    word="\${COMP_WORDS[i]}"
    if ((skip)); then skip=0; continue; fi
    case "$word" in
      ${values.join('|')}) skip=1 ;;
      -*) ;;
      *) path="\${path:+$path }$word" ;;
    esac
  done
  case "$prev" in
    --profile) COMPREPLY=($(compgen -W "${PROFILES}" -- "$cur")); return ;;
    -d|--data) COMPREPLY=($(compgen -f -- "$cur")); return ;;
    ${values.filter((flag) => !['--profile', '-d', '--data'].includes(flag)).join('|')}) COMPREPLY=(); return ;;
  esac
  case "$path" in
    "") words="${rootWords.join(' ')}" ;;
${cases.join('\n')}
    *) words="${globalFlags.join(' ')}" ;;
  esac
  COMPREPLY=($(compgen -W "$words" -- "$cur"))
}
complete -o default -F _steel_completion steel
`
}

export function zshScript(root: CommandSpec, globals: OptionSpec[]): string {
  const all = flatten(root)
  const values = valueFlags([...all, { ...root, options: globals }])
  const globalFlags = globals.flatMap(flags)
  const describe = (spec: CommandSpec) =>
    spec.subcommands
      .map(
        (sub) =>
          `'${quoteSingle(sub.name)}:${quoteSingle(sub.description).replace(/:/g, '\\:')}'`,
      )
      .join(' ')
  const cases: string[] = []
  for (const spec of byDepth(all.filter((s) => s.path))) {
    const optionWords = [...spec.options.flatMap(flags), ...globalFlags]
    const positional = POSITIONAL_VALUES[spec.path]
    const valuesLine =
      positional === 'profiles'
        ? `values=(\${(f)"${PROFILES}"})`
        : `values=(${(positional ?? []).join(' ')})`
    cases.push(
      `    ("${spec.path}") commands=(${describe(spec)}); ${valuesLine}; options=(${optionWords.join(' ')}) ;;`,
    )
    cases.push(`    ("${spec.path} "*) options=(${optionWords.join(' ')}) ;;`)
  }
  return `#compdef steel
# Steel CLI: autocomplete para zsh.
# Instale com: steel completion zsh > "\${fpath[1]}/_steel"
_steel() {
  local -a parts commands values options
  local i word skip=0
  for ((i = 2; i < CURRENT; i++)); do
    word=\${words[i]}
    if ((skip)); then skip=0; continue; fi
    case $word in
      (${values.join('|')}) skip=1 ;;
      (-*) ;;
      (*) parts+=($word) ;;
    esac
  done
  case \${words[CURRENT-1]} in
    (--profile) compadd -- \${(f)"${PROFILES}"}; return ;;
    (-d|--data) _files; return ;;
    (${values.filter((flag) => !['--profile', '-d', '--data'].includes(flag)).join('|')}) return ;;
  esac
  local key="\${(j: :)parts}"
  case $key in
    ("") commands=(${describe(root)}); options=(${root.options.flatMap(flags).join(' ')}) ;;
${cases.join('\n')}
    (*) options=(${globalFlags.join(' ')}) ;;
  esac
  if [[ $PREFIX == -* ]]; then
    compadd -- $options
    return
  fi
  (( $#commands )) && _describe -t commands 'comando' commands
  (( $#values )) && compadd -- $values
  return 0
}
if [ "$funcstack[1]" = "_steel" ]; then
  _steel "$@"
else
  compdef _steel steel
fi
`
}

export function fishScript(root: CommandSpec, globals: OptionSpec[]): string {
  const all = flatten(root)
  const values = valueFlags([...all, { ...root, options: globals }])
  const option = (spec: OptionSpec, condition?: string) => {
    const parts = ['complete -c steel']
    if (condition) parts.push(`-n '${condition}'`)
    if (spec.short) parts.push(`-s ${spec.short.replace(/^-/, '')}`)
    if (spec.long) parts.push(`-l ${spec.long.replace(/^--/, '')}`)
    if (spec.long === '--profile')
      parts.push(`-x -a '(steel __complete profiles 2>/dev/null)'`)
    else if (spec.long === '--data') parts.push('-r -F')
    else if (spec.takesValue) parts.push('-x')
    parts.push(`-d '${quoteSingle(spec.description)}'`)
    return parts.join(' ')
  }
  const lines = [
    '# Steel CLI: autocomplete para fish.',
    '# Instale com: steel completion fish > ~/.config/fish/completions/steel.fish',
    'function __steel_path',
    '  set -l tokens (commandline -opc)',
    '  set -e tokens[1]',
    '  set -l out',
    '  set -l skip 0',
    '  for token in $tokens',
    '    if test $skip -eq 1',
    '      set skip 0',
    '      continue',
    '    end',
    '    switch $token',
    `      case ${values.join(' ')}`,
    '        set skip 1',
    "      case '-*'",
    "      case '*'",
    '        set -a out $token',
    '    end',
    '  end',
    "  string join ' ' $out",
    'end',
    'function __steel_at',
    '  set -l current (__steel_path)',
    '  test "$current" = "$argv[1]"',
    'end',
    'function __steel_in',
    '  set -l current (__steel_path)',
    '  string match -q -- "$argv[1]*" "$current"',
    'end',
    'complete -c steel -f',
  ]
  for (const spec of all) {
    for (const sub of spec.subcommands) {
      lines.push(
        `complete -c steel -n '__steel_at "${spec.path}"' -a ${sub.name} -d '${quoteSingle(sub.description)}'`,
      )
    }
    const positional = POSITIONAL_VALUES[spec.path]
    if (positional) {
      const words =
        positional === 'profiles'
          ? '(steel __complete profiles 2>/dev/null)'
          : positional.join(' ')
      lines.push(
        `complete -c steel -n '__steel_at "${spec.path}"' -a '${words}'`,
      )
    }
    if (spec.path) {
      for (const opt of spec.options) {
        lines.push(option(opt, `__steel_in "${spec.path}"`))
      }
    }
  }
  for (const opt of globals) lines.push(option(opt))
  return `${lines.join('\n')}\n`
}

export function completionScript(program: Command, shell: string): string {
  const root = specFromCommand(program)
  const globals = root.options.filter(
    (option) => option.long !== '--version' && option.long !== '--help',
  )
  switch (shell) {
    case 'bash':
      return bashScript(root, globals)
    case 'zsh':
      return zshScript(root, globals)
    case 'fish':
      return fishScript(root, globals)
    default:
      throw usageError(
        `Shell não suportado: ${shell}`,
        `Use ${SHELLS.join(', ')}.`,
      )
  }
}
