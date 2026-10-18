import pkg from '../package.json' with { type: 'json' }

export const PACKAGE_NAME: string = pkg.name
export const VERSION: string = pkg.version

/** How this copy of the CLI was installed; drives the update hint. */
export type Distribution = 'npm' | 'binary' | 'source'

export interface BuildInfo {
  version: string
  /** Short git commit of the build; `null` when run from sources. */
  commit: string | null
  /** Build date (`YYYY-MM-DD`, UTC); `null` when run from sources. */
  date: string | null
  distribution: Distribution
}

/** The build-time values, as `scripts/lib/build-defines.ts` writes them. */
export interface RawBuildInfo {
  commit?: string
  date?: string
  distribution?: string
}

const COMMIT = /^[0-9a-f]{7,40}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

export function resolveBuildInfo(raw: RawBuildInfo): BuildInfo {
  const distribution: Distribution =
    raw.distribution === 'npm' || raw.distribution === 'binary'
      ? raw.distribution
      : 'source'
  return {
    version: VERSION,
    commit:
      raw.commit && COMMIT.test(raw.commit) ? raw.commit.slice(0, 7) : null,
    date: raw.date && DATE.test(raw.date) ? raw.date : null,
    distribution,
  }
}

/**
 * tsup and `bun build` replace these `process.env.*` reads with literals at
 * build time (see `scripts/lib/build-defines.ts`). From sources they are
 * unset and the build info says `source`.
 */
export const BUILD: BuildInfo = resolveBuildInfo({
  commit: process.env.STEEL_BUILD_COMMIT,
  date: process.env.STEEL_BUILD_DATE,
  distribution: process.env.STEEL_BUILD_DISTRIBUTION,
})

/** `steel 1.2.3 (abc1234, 2026-10-17)` — the `--version` line. */
export function versionLine(info: BuildInfo = BUILD): string {
  const details = [info.commit, info.date].filter(Boolean).join(', ')
  return `steel ${info.version} (${details || 'dev'})`
}

export const INSTALL_SCRIPT_URL =
  'https://raw.githubusercontent.com/steel-so/steel-cli/main/install.sh'

/** The command that updates this installation, shown by the update notice. */
export function upgradeCommand(
  info: BuildInfo = BUILD,
  execPath: string = process.execPath,
): string {
  if (info.distribution !== 'binary') return `npm install -g ${PACKAGE_NAME}`
  // Homebrew keeps every formula under a Cellar directory.
  if (/[\\/]Cellar[\\/]/.test(execPath)) return 'brew upgrade steel'
  return `curl -fsSL ${INSTALL_SCRIPT_URL} | sh`
}
