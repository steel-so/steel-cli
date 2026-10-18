/**
 * Compiles the CLI into a single-file binary with Bun and archives it:
 *
 *   bun scripts/compile.ts [--target <os>-<arch>] [--outdir release]
 *
 * Run it on the target's own OS and CPU (see `lib/targets.ts`): the keychain
 * addon is native, and Bun embeds the one installed for the host.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildCommit, buildDate, buildDefines } from './lib/build-info.js'
import { assetName, findTarget, hostTargetId } from './lib/targets.js'

declare const Bun: any

const ROOT = join(import.meta.dirname, '..')

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const id = option('--target') ?? hostTargetId(process.platform, process.arch)
const target = findTarget(id)
if (!target) {
  throw new Error(`unknown target ${id}`)
}
const outdir = resolve(ROOT, option('--outdir') ?? 'release')
const workdir = join(outdir, target.id)
rmSync(workdir, { recursive: true, force: true })
mkdirSync(workdir, { recursive: true })

const result = await Bun.build({
  entrypoints: [join(ROOT, 'packages/cli/src/bin.ts')],
  compile: { target: target.bun, outfile: join(workdir, target.executable) },
  // Build against the SDK sources, like tsup does.
  conditions: ['source'],
  minify: true,
  define: buildDefines({
    distribution: 'binary',
    commit: buildCommit(process.env, () =>
      execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: ROOT,
        encoding: 'utf8',
      }),
    ),
    date: buildDate(process.env),
  }),
  plugins: [
    {
      // Ink loads React DevTools only with DEV=true; Bun hoists that dynamic
      // import, so stub it instead of shipping or requiring the package.
      name: 'stub-react-devtools',
      setup(build: any) {
        build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
          path: 'react-devtools-core',
          namespace: 'stub',
        }))
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export default {}',
          loader: 'js',
        }))
      },
    },
  ],
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

const archive = join(outdir, assetName(target))
rmSync(archive, { force: true })
// On Windows, call the system bsdtar: Git Bash's GNU tar cannot write zip.
const tar =
  process.platform === 'win32'
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar'
const flags = target.archive === 'zip' ? ['-a', '-cf'] : ['-czf']
execFileSync(tar, [...flags, archive, '-C', workdir, target.executable], {
  stdio: 'inherit',
})
console.log(`built ${archive}`)
