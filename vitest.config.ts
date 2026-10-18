import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['packages/*', 'scripts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**', 'scripts/lib/**'],
      exclude: [
        'packages/sdk/src/generated/**',
        // Two lines of process wiring; everything it calls is tested.
        'packages/cli/src/bin.ts',
      ],
      reporter: ['text-summary', 'text'],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
})
