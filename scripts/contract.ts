/**
 * Release contract test (ADR 0034): the live Steel v1 document must stay
 * compatible with the snapshot the SDK was generated from.
 *
 *   pnpm contract:check                 # Steel homologação
 *   pnpm contract:check <url-or-path>   # another Steel or a local file
 *
 * Exits 1 on a breaking change or when the document cannot be read.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  checkContract,
  HOMOLOG_OPENAPI_URL,
  loadDocument,
  renderContractReport,
} from './lib/contract.js'

const SNAPSHOT = join(
  import.meta.dirname,
  '..',
  'packages/sdk/openapi/openapi.v1.json',
)

async function main(argv: string[]) {
  const source = argv[0] ?? HOMOLOG_OPENAPI_URL
  const deps = { fetch, readFile: (path: string) => readFile(path, 'utf8') }
  const result = checkContract(
    await readFile(SNAPSHOT, 'utf8'),
    await loadDocument(source, deps),
  )
  const report = renderContractReport(result, source)
  if (result.ok) {
    process.stdout.write(report)
  } else {
    process.stderr.write(report)
    process.exitCode = 1
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`contract: ${(error as Error).message}\n`)
  process.exitCode = 1
})
