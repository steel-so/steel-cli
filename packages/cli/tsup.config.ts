import { execFileSync } from 'node:child_process'
import { defineConfig } from 'tsup'
import {
  buildCommit,
  buildDate,
  buildDefines,
} from '../../scripts/lib/build-info.js'

export default defineConfig({
  entry: { steel: 'src/bin.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // The SDK is bundled in: the CLI ships as one file plus native keyring.
  noExternal: ['@steel-so/sdk'],
  esbuildOptions(options) {
    options.conditions = ['source']
    options.jsx = 'automatic'
    options.define = {
      ...options.define,
      ...buildDefines({
        distribution: 'npm',
        commit: buildCommit(process.env, () =>
          execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }),
        ),
        date: buildDate(process.env),
      }),
    }
  },
})
