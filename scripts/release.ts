/**
 * Release tooling. Versions come from git tags (`v<semver>`); nothing is
 * committed by a release, because `main` only takes pull requests.
 *
 *   pnpm release:tool next [patch|minor|major]
 *       Prints the next tag, inferred from the Conventional Commits since
 *       the last tag when no kind is given.
 *   pnpm release:tool stamp <tag>
 *       Writes the tag's version into both package.json files (CI only,
 *       before building and publishing).
 *   pnpm release:tool notes <tag>
 *       Release notes (the changelog) for the commits up to that tag.
 *   pnpm release:tool formula <tag> <SHA256SUMS>
 *       The Homebrew formula for steel-so/homebrew-tap.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderFormula } from './lib/homebrew.js'
import {
  type BumpKind,
  bumpVersion,
  type Commit,
  inferBump,
  renderReleaseNotes,
  stampVersion,
  versionFromTag,
} from './lib/release.js'

const ROOT = join(import.meta.dirname, '..')
const REPOSITORY = 'steel-so/steel-cli'
const PACKAGES = ['packages/sdk/package.json', 'packages/cli/package.json']

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/** The latest `v*` tag reachable from `ref`, excluding `ref` itself. */
function previousTag(ref: string): string | undefined {
  try {
    return git('describe', '--tags', '--abbrev=0', '--match', 'v*', `${ref}^`)
  } catch {
    return undefined
  }
}

function commitsBetween(from: string | undefined, to: string): Commit[] {
  const range = from ? `${from}..${to}` : to
  const raw = git('log', range, '--no-merges', '--format=%H%x1f%s%x1f%b%x1e')
  return raw
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = '', subject = '', body = ''] = record.split('\x1f')
      return { hash, subject, body }
    })
}

function requireVersion(tag: string | undefined): string {
  const version = versionFromTag(tag ?? '')
  if (!version) throw new Error(`not a release tag: ${tag ?? '(none)'}`)
  return version
}

function main(argv: string[]) {
  const [command, ...args] = argv
  switch (command) {
    case 'next': {
      const kind = args[0]
      if (kind && !['major', 'minor', 'patch'].includes(kind)) {
        throw new Error(`unknown bump: ${kind} (use patch, minor or major)`)
      }
      let last: string | undefined
      try {
        last = git('describe', '--tags', '--abbrev=0', '--match', 'v*')
      } catch {
        last = undefined
      }
      const current = last ? requireVersion(last) : '0.0.0'
      const commits = commitsBetween(last, 'HEAD')
      const next = last
        ? bumpVersion(
            current,
            (kind as BumpKind) ?? inferBump(current, commits),
          )
        : JSON.parse(readFileSync(join(ROOT, PACKAGES[1] as string), 'utf8'))
            .version
      process.stdout.write(`v${next}\n`)
      return
    }
    case 'stamp': {
      const version = requireVersion(args[0])
      for (const path of PACKAGES) {
        const file = join(ROOT, path)
        writeFileSync(file, stampVersion(readFileSync(file, 'utf8'), version))
      }
      return
    }
    case 'notes': {
      const tag = args[0] ?? ''
      const version = requireVersion(tag)
      const previous = previousTag(tag)
      process.stdout.write(
        renderReleaseNotes({
          version,
          commits: commitsBetween(previous, tag),
          repository: REPOSITORY,
          previousTag: previous,
        }),
      )
      return
    }
    case 'formula': {
      const [tag, sums = ''] = args
      process.stdout.write(
        renderFormula({
          version: requireVersion(tag),
          checksums: readFileSync(sums, 'utf8'),
          repository: REPOSITORY,
        }),
      )
      return
    }
    default:
      throw new Error('usage: release.ts next|stamp|notes|formula ...')
  }
}

try {
  main(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`release: ${(error as Error).message}\n`)
  process.exitCode = 1
}
