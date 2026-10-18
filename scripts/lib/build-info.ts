/**
 * Build-time metadata baked into the CLI. Both bundlers (tsup for npm,
 * `bun build --compile` for the binaries) replace these `process.env.*`
 * reads in `packages/cli/src/version.ts` with string literals.
 */
export type Distribution = 'npm' | 'binary'

export interface BuildInfoInput {
  distribution: Distribution
  /** Full or short git SHA; empty when unknown. */
  commit: string
  /** Build moment. */
  date: Date
}

export function buildDefines(input: BuildInfoInput): Record<string, string> {
  return {
    'process.env.STEEL_BUILD_COMMIT': JSON.stringify(input.commit),
    'process.env.STEEL_BUILD_DATE': JSON.stringify(
      input.date.toISOString().slice(0, 10),
    ),
    'process.env.STEEL_BUILD_DISTRIBUTION': JSON.stringify(input.distribution),
  }
}

/**
 * The build date: `SOURCE_DATE_EPOCH` (reproducible builds) when set,
 * otherwise now.
 */
export function buildDate(
  env: Record<string, string | undefined>,
  now: () => Date = () => new Date(),
): Date {
  const epoch = Number(env.SOURCE_DATE_EPOCH)
  return env.SOURCE_DATE_EPOCH && Number.isFinite(epoch)
    ? new Date(epoch * 1000)
    : now()
}

/** `GITHUB_SHA` in Actions, otherwise what `git rev-parse` printed. */
export function buildCommit(
  env: Record<string, string | undefined>,
  gitHead: () => string,
): string {
  if (env.GITHUB_SHA) return env.GITHUB_SHA
  try {
    return gitHead().trim()
  } catch {
    return ''
  }
}
