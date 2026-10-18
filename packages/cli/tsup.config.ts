import { defineConfig } from 'tsup'

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
  },
})
