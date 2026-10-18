import type { Context } from '../context.js'
import { KeyValue } from '../ui/components.js'
import { BUILD, type BuildInfo, type Distribution } from '../version.js'

const DISTRIBUTION_LABELS: Record<Distribution, string> = {
  npm: 'npm',
  binary: 'binário',
  source: 'código-fonte',
}

function runtime(): string {
  const bun = (process.versions as Record<string, string | undefined>).bun
  return bun ? `bun ${bun}` : `node ${process.versions.node}`
}

/** `steel version`: version, commit, build date, platform and runtime. */
export async function version(ctx: Context, info: BuildInfo = BUILD) {
  const details = {
    ...info,
    platform: process.platform,
    arch: process.arch,
    runtime: runtime(),
  }
  if (ctx.json) {
    ctx.printJson(details)
    return
  }
  ctx.render(
    <KeyValue
      rows={[
        ['Versão', details.version],
        ['Commit', details.commit ?? '—'],
        ['Build', details.date ?? '—'],
        ['Instalação', DISTRIBUTION_LABELS[details.distribution]],
        ['Plataforma', `${details.platform}-${details.arch}`],
        ['Runtime', details.runtime],
      ]}
    />,
  )
}
