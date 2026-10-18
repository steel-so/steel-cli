import { fileURLToPath } from 'node:url'
import { defineProject } from 'vitest/config'

export default defineProject({
  resolve: {
    // Test against the SDK sources, like the `source` condition in tsc/tsup.
    alias: {
      '@steel-so/sdk': fileURLToPath(
        new URL('../sdk/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    name: 'cli',
    environment: 'node',
  },
})
