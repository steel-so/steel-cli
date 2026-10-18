#!/usr/bin/env node
// Colors must be decided before chalk/Ink load: NO_COLOR, --no-color and
// --json all mean plain text (ADR 0034).
const argv = process.argv.slice(2)
if (
  process.env.NO_COLOR ||
  argv.includes('--no-color') ||
  argv.includes('--json')
) {
  process.env.FORCE_COLOR = '0'
}

const { processDeps, runCli } = await import('./main.js')
process.exitCode = await runCli(argv, processDeps())
