/**
 * Release helpers: lockstep SemVer for both packages, a changelog section
 * built from Conventional Commits, and release notes for the GitHub release.
 */

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

export type BumpKind = 'major' | 'minor' | 'patch'

export interface Commit {
  hash: string
  subject: string
  body: string
}

export interface ParsedCommit {
  hash: string
  type: string
  scope?: string
  description: string
  breaking: boolean
}

export function isVersion(value: string): boolean {
  return SEMVER.test(value)
}

export function isPrerelease(version: string): boolean {
  return Boolean(SEMVER.exec(version)?.[4])
}

/** Next version. A prerelease bumps to its own stable version first. */
export function bumpVersion(current: string, kind: BumpKind): string {
  const match = SEMVER.exec(current)
  if (!match) throw new Error(`invalid version: ${current}`)
  const [major, minor, patch] = match.slice(1, 4).map(Number) as [
    number,
    number,
    number,
  ]
  if (match[4]) {
    return `${major}.${minor}.${patch}`
  }
  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

const HEADER = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/

export function parseCommit(commit: Commit): ParsedCommit | undefined {
  const match = HEADER.exec(commit.subject.trim())
  if (!match?.[1] || !match[4]) return undefined
  return {
    hash: commit.hash,
    type: match[1],
    scope: match[2],
    description: match[4],
    breaking:
      Boolean(match[3]) || /^BREAKING[ -]CHANGE: /m.test(commit.body ?? ''),
  }
}

/**
 * The bump the commits ask for. Before 1.0.0 a breaking change is a minor
 * bump and a feature a patch, as SemVer allows for 0.x.
 */
export function inferBump(current: string, commits: Commit[]): BumpKind {
  const parsed = commits.map(parseCommit).filter((c): c is ParsedCommit => !!c)
  const breaking = parsed.some((c) => c.breaking)
  const feature = parsed.some((c) => c.type === 'feat')
  const initial = current.startsWith('0.')
  if (breaking) return initial ? 'minor' : 'major'
  if (feature) return initial ? 'patch' : 'minor'
  return 'patch'
}

const SECTIONS: Array<{ title: string; match: (c: ParsedCommit) => boolean }> =
  [
    { title: 'Mudanças incompatíveis', match: (c) => c.breaking },
    { title: 'Novidades', match: (c) => !c.breaking && c.type === 'feat' },
    { title: 'Correções', match: (c) => !c.breaking && c.type === 'fix' },
    { title: 'Desempenho', match: (c) => !c.breaking && c.type === 'perf' },
  ]

/** `v1.2.3` → `1.2.3`; `undefined` when the tag is not `v<semver>`. */
export function versionFromTag(tag: string): string | undefined {
  const version = tag.replace(/^refs\/tags\//, '')
  return version.startsWith('v') && isVersion(version.slice(1))
    ? version.slice(1)
    : undefined
}

export interface ReleaseNotesInput {
  version: string
  commits: Commit[]
  repository: string
  /** Previous release tag, for the compare link. */
  previousTag?: string
}

/**
 * The changelog of one release, in pt-BR: one list per kind of change, with
 * links to the commits. It is the body of the GitHub release, which is the
 * project's changelog (versions come from tags; nothing is committed).
 */
export function renderReleaseNotes(input: ReleaseNotesInput): string {
  const { version, commits, repository, previousTag } = input
  const parsed = commits.map(parseCommit).filter((c): c is ParsedCommit => !!c)
  const lines: string[] = []
  for (const section of SECTIONS) {
    const entries = parsed.filter(section.match)
    if (entries.length === 0) continue
    lines.push(`### ${section.title}`, '')
    for (const entry of entries) {
      const scope = entry.scope ? `**${entry.scope}:** ` : ''
      const short = entry.hash.slice(0, 7)
      lines.push(
        `- ${scope}${entry.description} ([${short}](https://github.com/${repository}/commit/${entry.hash}))`,
      )
    }
    lines.push('')
  }
  if (lines.length === 0) {
    lines.push('Manutenção interna, sem mudanças visíveis.', '')
  }
  if (previousTag) {
    lines.push(
      `**Todas as mudanças:** https://github.com/${repository}/compare/${previousTag}...v${version}`,
      '',
    )
  }
  return `${lines.join('\n').trimEnd()}\n`
}

/** Writes `version` into a package.json text, keeping its formatting. */
export function stampVersion(packageJson: string, version: string): string {
  const json = JSON.parse(packageJson)
  json.version = version
  return `${JSON.stringify(json, null, 2)}\n`
}
