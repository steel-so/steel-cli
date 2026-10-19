import { stripVTControlCharacters } from 'node:util'
import chalk from 'chalk'
import { describe, expect, it } from 'vitest'
import { parseQuery, resolveApiPath } from '../src/commands/api.js'
import { formatJson } from '../src/ui/json.js'
import { fail, harness, json, ok } from './harness.js'

async function loggedIn(options: Parameters<typeof harness>[0] = {}) {
  const h = harness(options)
  await h.keychain?.set('homologacao', 'stl_pat_saved')
  return h
}

describe('resolveApiPath', () => {
  it.each([
    ['/me', '/api/v1/me'],
    ['me', '/api/v1/me'],
    ['/api/v1/me', '/api/v1/me'],
    ['/api/v1', '/api/v1'],
    ['/', '/api/v1'],
    ['/api/v10/x', '/api/v1/api/v10/x'],
  ])('%s → %s', (input, path) => {
    expect(resolveApiPath(input).path).toBe(path)
  })

  it('keeps the query string', () => {
    expect(resolveApiPath('/crm/leads?limit=5&tag=a&tag=b')).toEqual({
      path: '/api/v1/crm/leads',
      query: { limit: ['5'], tag: ['a', 'b'] },
    })
  })

  it('refuses full URLs and dot segments', () => {
    expect(() => resolveApiPath('https://evil.example/api/v1/me')).toThrow(
      'Informe só o caminho',
    )
    expect(() => resolveApiPath('/../internal')).toThrow('“..”')
  })

  it('parses -q pairs', () => {
    expect(parseQuery(['a=1', 'a=2', 'b=x=y'])).toEqual({
      a: ['1', '2'],
      b: ['x=y'],
    })
    expect(parseQuery()).toEqual({})
    expect(() => parseQuery(['novalue'])).toThrow('Parâmetro inválido')
  })
})

describe('steel api', () => {
  it('GETs a v1 route with query params and prints the body', async () => {
    const h = await loggedIn()
    h.reply(ok({ items: [], nextCursor: null }))

    const code = await h.run(
      'api',
      'get',
      '/servicedesk/tickets?status=open',
      '-q',
      'limit=5',
    )

    expect(code).toBe(0)
    expect(h.requests[0]?.method).toBe('GET')
    expect(h.requests[0]?.url).toBe(
      'https://homologacao.stratustelecom.com.br/api/v1/servicedesk/tickets?status=open&limit=5',
    )
    expect(h.requests[0]?.headers.get('authorization')).toBe(
      'Bearer stl_pat_saved',
    )
    expect(h.outJson().data).toEqual({ items: [], nextCursor: null })
  })

  it('POSTs a body from the flag, a file or stdin', async () => {
    const h = await loggedIn({
      files: { 'lead.json': '{"name":"Arquivo"}' },
      stdin: '{"name":"Stdin"}',
    })
    h.reply(ok({ id: 1 }, 201), ok({ id: 2 }, 201), ok({ id: 3 }, 201))

    await h.run('api', 'POST', '/crm/leads', '-d', '{"name":"Flag"}')
    await h.run('api', 'POST', '/crm/leads', '-d', '@lead.json')
    await h.run('api', 'PATCH', '/crm/leads', '--data', '@-')

    const bodies = await Promise.all(h.requests.map((r) => r.json()))
    expect(bodies).toEqual([
      { name: 'Flag' },
      { name: 'Arquivo' },
      { name: 'Stdin' },
    ])
    expect(h.requests[2]?.method).toBe('PATCH')
    expect(h.requests[0]?.headers.get('content-type')).toBe('application/json')
  })

  it.each([
    [['api', 'FETCH', '/me'], 'Método HTTP inválido'],
    [['api', 'GET', '/me', '-d', '{}'], 'GET não aceita corpo'],
    [['api', 'POST', '/me', '-d', '{oops'], 'O corpo não é um JSON válido.'],
    [['api', 'POST', '/me', '-d', '@missing.json'], 'Não foi possível ler'],
    [['api', 'GET', 'https://x.example/me'], 'Informe só o caminho'],
    [['api', 'GET', '/me', '-q', 'bad'], 'Parâmetro inválido'],
  ])('refuses %j before any request', async (argv, message) => {
    const h = await loggedIn()
    expect(await h.run(...argv)).toBe(2)
    expect(h.errJson().error.message).toContain(message)
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('prints HTTP errors to stdout and exits non-zero', async () => {
    const h = await loggedIn({ tty: true })
    h.reply(fail(404, 'NOT_FOUND'), fail(403, 'FORBIDDEN'), json(500, 'boom'))

    expect(await h.run('api', 'GET', '/x')).toBe(1)
    expect(h.out()).toContain('"NOT_FOUND"')
    expect(h.err()).toContain('GET /api/v1/x respondeu 404 (NOT_FOUND).')
    expect(await h.run('api', 'DELETE', '/x')).toBe(3)
    expect(await h.run('api', 'GET', '/y')).toBe(1)
    expect(h.err()).toContain('GET /api/v1/y respondeu 500.')
  })

  it('names the missing scope on API_TOKEN_SCOPE_REQUIRED', async () => {
    const h = await loggedIn({ tty: true })
    h.reply(
      json(403, {
        success: false,
        statusCode: 403,
        message: 'Este token só permite leitura.',
        error: {
          code: 'API_TOKEN_SCOPE_REQUIRED',
          details: { requiredScope: 'api:write' },
        },
      }),
    )

    expect(await h.run('api', 'POST', '/webhooks/endpoints', '-d', '{}')).toBe(
      3,
    )
    expect(h.err()).toContain('respondeu 403 (API_TOKEN_SCOPE_REQUIRED).')
    expect(h.err()).toContain('O token não tem o escopo api:write.')
  })

  it('keeps stderr clean in JSON mode and passes text bodies through', async () => {
    const h = await loggedIn()
    h.reply(
      fail(404, 'NOT_FOUND'),
      new Response('plain text', { status: 200 }),
      new Response('line\n', { status: 200 }),
      new Response(null, { status: 204 }),
    )

    expect(await h.run('api', 'GET', '/x')).toBe(1)
    expect(h.err()).toBe('')
    h.stdout.output = ''
    await h.run('api', 'GET', '/text')
    await h.run('api', 'GET', '/line')
    await h.run('api', 'DELETE', '/x')
    expect(h.out()).toBe('plain text\nline\n')
  })

  it('needs a login and reports network failures', async () => {
    const anonymous = harness({ keychain: null })
    expect(await anonymous.run('api', 'GET', '/me')).toBe(3)

    const h = await loggedIn()
    h.reply(new DOMException('slow', 'TimeoutError'))
    expect(await h.run('api', 'GET', '/me')).toBe(1)
    expect(h.errJson().error.code).toBe('TIMEOUT')
  })
})

describe('formatJson', () => {
  it('is plain without colors and colored with them', () => {
    const value = { a: 'x', b: 1, c: true, d: null }
    expect(formatJson(value)).toBe(JSON.stringify(value, null, 2))
    expect(formatJson(undefined)).toBe('null')
    const level = chalk.level
    chalk.level = 3
    try {
      const colored = formatJson(value)
      expect(colored).not.toBe(JSON.stringify(value, null, 2))
      expect(stripVTControlCharacters(colored)).toBe(
        JSON.stringify(value, null, 2),
      )
    } finally {
      chalk.level = level
    }
  })
})
