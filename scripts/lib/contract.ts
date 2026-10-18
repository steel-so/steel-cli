import { findBreakingChanges, type JsonSchema } from './openapi-compat.js'

/** The Steel homologação document the release contract test reads. */
export const HOMOLOG_OPENAPI_URL =
  'https://homologacao.stratustelecom.com.br/dev/api/v1/openapi.json'

export interface ContractResult {
  ok: boolean
  snapshotVersion: string
  liveVersion: string
  breaking: string[]
}

function parseDocument(text: string, label: string): JsonSchema {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`${label} is not JSON: ${(error as Error).message}`)
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    typeof (parsed as JsonSchema).paths !== 'object'
  ) {
    throw new Error(`${label} is not an OpenAPI document (no "paths")`)
  }
  return parsed as JsonSchema
}

function versionOf(doc: JsonSchema): string {
  const info = doc.info as { version?: unknown } | undefined
  return typeof info?.version === 'string' ? info.version : 'unknown'
}

/**
 * Compares the snapshot the SDK was generated from (`base`) with the
 * document a live Steel serves (`live`). Anything the live API dropped or
 * narrowed would break the published SDK and CLI.
 */
export function checkContract(
  snapshotText: string,
  liveText: string,
): ContractResult {
  const snapshot = parseDocument(snapshotText, 'SDK snapshot')
  const live = parseDocument(liveText, 'live document')
  const breaking = findBreakingChanges(snapshot, live)
  return {
    ok: breaking.length === 0,
    snapshotVersion: versionOf(snapshot),
    liveVersion: versionOf(live),
    breaking,
  }
}

export function renderContractReport(
  result: ContractResult,
  source: string,
): string {
  const versions = `snapshot ${result.snapshotVersion}, live ${result.liveVersion}`
  if (result.ok) {
    return `The SDK snapshot is compatible with ${source} (${versions}).\n`
  }
  return [
    `${result.breaking.length} breaking change(s) between the SDK snapshot and ${source} (${versions}):`,
    ...result.breaking.map((change) => `  - ${change}`),
    'The published SDK and CLI would break against this Steel. Fix the API (v1 is additive only, ADR 0035) or regenerate the SDK and adapt the CLI before releasing.',
    '',
  ].join('\n')
}

/** Reads a document from an http(s) URL or a local file. */
export async function loadDocument(
  source: string,
  deps: {
    fetch: typeof fetch
    readFile: (path: string) => Promise<string>
  },
): Promise<string> {
  if (!/^https?:\/\//.test(source)) return deps.readFile(source)
  const response = await deps.fetch(source, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    throw new Error(`GET ${source} failed with ${response.status}`)
  }
  return response.text()
}
