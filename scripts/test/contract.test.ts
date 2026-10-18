import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  checkContract,
  HOMOLOG_OPENAPI_URL,
  loadDocument,
  renderContractReport,
} from '../lib/contract.js'

const snapshot = readFileSync(
  join(import.meta.dirname, '../../packages/sdk/openapi/openapi.v1.json'),
  'utf8',
)

describe('checkContract', () => {
  it('accepts the snapshot against itself', () => {
    const result = checkContract(snapshot, snapshot)
    expect(result.ok).toBe(true)
    expect(result.breaking).toEqual([])
    expect(result.snapshotVersion).toBe(result.liveVersion)
    expect(renderContractReport(result, 'here')).toMatch(
      /^The SDK snapshot is compatible with here \(snapshot .+, live .+\)\.\n$/,
    )
  })

  it('flags an operation the live document dropped', () => {
    const live = JSON.parse(snapshot)
    const [path] = Object.keys(live.paths)
    delete live.paths[path as string]
    live.info.version = '2099.01.01'
    const result = checkContract(snapshot, JSON.stringify(live))
    expect(result.ok).toBe(false)
    expect(result.liveVersion).toBe('2099.01.01')
    expect(result.breaking.some((line) => line.endsWith(': removed'))).toBe(
      true,
    )
    const report = renderContractReport(result, HOMOLOG_OPENAPI_URL)
    expect(report).toContain(
      `breaking change(s) between the SDK snapshot and ${HOMOLOG_OPENAPI_URL}`,
    )
    expect(report).toContain(`  - ${result.breaking[0]}`)
  })

  it('reports a missing version as unknown', () => {
    const bare = JSON.stringify({ paths: {} })
    expect(checkContract(bare, bare)).toEqual({
      ok: true,
      snapshotVersion: 'unknown',
      liveVersion: 'unknown',
      breaking: [],
    })
  })

  it('rejects what is not an OpenAPI document', () => {
    expect(() => checkContract('<html>', snapshot)).toThrow(
      /SDK snapshot is not JSON/,
    )
    expect(() => checkContract(snapshot, '[]')).toThrow(
      'live document is not an OpenAPI document (no "paths")',
    )
    expect(() => checkContract(snapshot, 'null')).toThrow(/no "paths"/)
    expect(() => checkContract(snapshot, '{"openapi":"3.1.0"}')).toThrow(
      /no "paths"/,
    )
  })
})

describe('loadDocument', () => {
  it('reads a local file', async () => {
    const readFile = vi.fn(async () => '{}')
    const fetchMock = vi.fn()
    await expect(
      loadDocument('openapi.json', { fetch: fetchMock, readFile }),
    ).resolves.toBe('{}')
    expect(readFile).toHaveBeenCalledWith('openapi.json')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('downloads a URL', async () => {
    const fetchMock = vi.fn(async () => new Response('{"paths":{}}'))
    await expect(
      loadDocument(HOMOLOG_OPENAPI_URL, {
        fetch: fetchMock as unknown as typeof fetch,
        readFile: vi.fn(),
      }),
    ).resolves.toBe('{"paths":{}}')
    expect(fetchMock).toHaveBeenCalledWith(
      HOMOLOG_OPENAPI_URL,
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    )
  })

  it('fails on an HTTP error', async () => {
    const fetchMock = vi.fn(async () => new Response('down', { status: 503 }))
    await expect(
      loadDocument('http://localhost:3001/dev/api/v1/openapi.json', {
        fetch: fetchMock as unknown as typeof fetch,
        readFile: vi.fn(),
      }),
    ).rejects.toThrow(
      'GET http://localhost:3001/dev/api/v1/openapi.json failed with 503',
    )
  })
})
