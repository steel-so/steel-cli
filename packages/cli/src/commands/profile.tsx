import {
  BUILTIN_PROFILES,
  isPlaceholderUrl,
  isValidProfileName,
  normalizeBaseUrl,
} from '../config/profiles.js'
import type { Context } from '../context.js'
import { usageError } from '../errors.js'
import { Code, Hint, Success, Table } from '../ui/components.js'

export async function profileList(ctx: Context) {
  const config = await ctx.config.read()
  const current =
    ctx.options.profile ?? ctx.env.STEEL_PROFILE ?? config.currentProfile
  const profiles = Object.entries(config.profiles).map(([name, profile]) => ({
    name,
    url: profile.url,
    current: name === current,
    workspace: profile.session?.workspace ?? null,
    expiresAt: profile.session?.expiresAt ?? null,
  }))

  if (ctx.json) {
    ctx.printJson(profiles)
    return
  }

  ctx.render(
    <Table
      columns={[
        { key: 'marker', label: ' ' },
        { key: 'name', label: 'Perfil' },
        { key: 'url', label: 'URL' },
        { key: 'workspace', label: 'Workspace' },
      ]}
      rows={profiles.map((profile) => ({
        marker: profile.current ? '*' : '',
        name: profile.name,
        url: isPlaceholderUrl(profile.url) ? '(a definir)' : profile.url,
        workspace: profile.workspace?.slug ?? '—',
      }))}
      highlight={(row) => row.marker === '*'}
    />,
  )
}

export async function profileUse(ctx: Context, name: string) {
  await ctx.config.update((config) => {
    if (!config.profiles[name]) {
      throw usageError(
        `O perfil “${name}” não existe.`,
        'Veja os perfis com `steel profile list`.',
      )
    }
    config.currentProfile = name
  })
  if (ctx.json) {
    ctx.printJson({ currentProfile: name })
    return
  }
  ctx.render(<Success>Perfil atual: {name}.</Success>)
}

export interface ProfileAddOptions {
  url: string
  use?: boolean
  force?: boolean
}

export async function profileAdd(
  ctx: Context,
  name: string,
  options: ProfileAddOptions,
) {
  if (!isValidProfileName(name)) {
    throw usageError(
      `Nome de perfil inválido: ${name}`,
      'Use letras minúsculas, números, - e _ (até 32 caracteres).',
    )
  }
  const url = normalizeBaseUrl(options.url)
  if (!url) {
    throw usageError(
      `URL inválida: ${options.url}`,
      'Use https:// (http:// só em localhost), sem usuário, query ou #.',
    )
  }

  const config = await ctx.config.read()
  const existing = config.profiles[name]
  if (existing && !options.force) {
    throw usageError(
      `O perfil “${name}” já existe.`,
      'Use --force para trocar a URL (o login salvo nele é removido).',
    )
  }
  if (existing) await ctx.credentials.remove(name)
  config.profiles[name] = { url }
  if (options.use) config.currentProfile = name
  await ctx.config.write(config)

  if (ctx.json) {
    ctx.printJson({
      name,
      url,
      current: config.currentProfile === name,
      builtin: name in BUILTIN_PROFILES,
    })
    return
  }
  ctx.render(
    <>
      <Success>
        Perfil {name} {existing ? 'atualizado' : 'criado'}: {url}
      </Success>
      <Hint>
        Entre com <Code>steel login --profile {name}</Code>
        {options.use ? '' : ' ou torne-o o atual com `steel profile use`'}.
      </Hint>
    </>,
  )
}

/** Names for shell completion (hidden `__complete profiles`). */
export async function profileNames(ctx: Context) {
  const config = await ctx.config.read()
  ctx.io.stdout.write(`${Object.keys(config.profiles).join('\n')}\n`)
}
