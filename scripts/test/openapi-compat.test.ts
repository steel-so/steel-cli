import { describe, expect, it } from 'vitest'
import { findBreakingChanges, type JsonSchema } from '../lib/openapi-compat.js'

/** A minimal v1-like document: one GET and one POST over a `Thing`. */
function doc(
  overrides: {
    thing?: JsonSchema
    body?: JsonSchema | null
    bodyRequired?: boolean
    bodyType?: string
    params?: JsonSchema[]
    getResponses?: JsonSchema
    extraPaths?: JsonSchema
  } = {},
): JsonSchema {
  const thing = overrides.thing ?? {
    type: 'object',
    required: ['id', 'name'],
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      count: { type: 'integer' },
      tags: { type: 'array', items: { type: 'string' } },
    },
  }
  const body =
    overrides.body === null
      ? undefined
      : {
          required: overrides.bodyRequired ?? true,
          content: {
            [overrides.bodyType ?? 'application/json']: {
              schema: overrides.body ?? {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  kind: { type: 'string', enum: ['A', 'B'] },
                },
              },
            },
          },
        }
  const envelope = (data: JsonSchema) => ({
    content: {
      'application/json': {
        schema: {
          allOf: [
            { $ref: '#/components/schemas/SuccessEnvelope' },
            { type: 'object', properties: { data } },
          ],
        },
      },
    },
  })
  return {
    paths: {
      '/things': {
        get: {
          parameters: overrides.params ?? [
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer' },
            },
          ],
          responses: overrides.getResponses ?? {
            200: envelope({
              type: 'object',
              properties: {
                items: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Thing' },
                },
                nextCursor: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              },
            }),
            401: { $ref: '#/components/responses/401_UNAUTHORIZED' },
          },
        },
        post: {
          ...(body && { requestBody: body }),
          responses: { 201: envelope({ $ref: '#/components/schemas/Thing' }) },
        },
      },
      ...(overrides.extraPaths ?? {}),
    },
    components: {
      schemas: {
        Thing: thing,
        SuccessEnvelope: {
          type: 'object',
          properties: { success: { type: 'boolean' }, data: {} },
        },
      },
      responses: { '401_UNAUTHORIZED': { description: 'x' } },
    },
  }
}

const thingWith = (
  patch: (props: Record<string, JsonSchema>, required: string[]) => void,
) => {
  const props: Record<string, JsonSchema> = {
    id: { type: 'string' },
    name: { type: 'string' },
    count: { type: 'integer' },
    tags: { type: 'array', items: { type: 'string' } },
  }
  const required = ['id', 'name']
  patch(props, required)
  return { type: 'object', required, properties: props }
}

describe('findBreakingChanges', () => {
  it('passes an identical document', () => {
    expect(findBreakingChanges(doc(), doc())).toEqual([])
  })

  it('passes additive changes: new route, new optional input, new response field', () => {
    const next = doc({
      thing: thingWith((props) => {
        props.extra = { type: 'string' }
      }),
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          kind: { type: 'string', enum: ['A', 'B', 'C'] },
          note: { type: 'string' },
        },
      },
      params: [
        { name: 'limit', in: 'query', schema: { type: 'integer' } },
        { name: 'q', in: 'query', required: false, schema: { type: 'string' } },
      ],
      extraPaths: { '/other': { get: { responses: { 200: {} } } } },
    })
    expect(findBreakingChanges(doc(), next)).toEqual([])
  })

  it('flags a removed path or operation', () => {
    const next = doc()
    delete (next.paths as Record<string, JsonSchema>)['/things']
    expect(findBreakingChanges(doc(), next)).toEqual([
      'GET /things: removed',
      'POST /things: removed',
    ])
  })

  it('flags a removed response field, in every operation that returns it', () => {
    const next = doc({ thing: thingWith((props) => delete props.name) })
    expect(findBreakingChanges(doc(), next)).toEqual([
      'GET /things 200.data.items[].name: removed',
      'POST /things 201.data.name: removed',
    ])
  })

  it('flags a response field that may now be absent or changed type', () => {
    const next = doc({
      thing: thingWith((props, required) => {
        required.splice(required.indexOf('name'), 1)
        props.count = { type: 'string' }
        props.id = { anyOf: [{ type: 'string' }, { type: 'null' }] }
      }),
    })
    expect(findBreakingChanges(doc(), next)).toEqual(
      expect.arrayContaining([
        'POST /things 201.data.id: response type gained null',
        'POST /things 201.data.name: no longer always present',
        'POST /things 201.data.count: response type gained string',
      ]),
    )
  })

  it('accepts integer → number widening only in requests, number → integer in responses', () => {
    const base = doc({
      thing: thingWith((props) => (props.count = { type: 'number' })),
    })
    const next = doc({
      thing: thingWith((props) => (props.count = { type: 'integer' })),
    })
    expect(findBreakingChanges(base, next)).toEqual([])
    expect(findBreakingChanges(next, base)).toContain(
      'POST /things 201.data.count: response type gained number',
    )
  })

  it('flags array item changes', () => {
    const next = doc({
      thing: thingWith(
        (props) => (props.tags = { type: 'array', items: { type: 'integer' } }),
      ),
    })
    expect(findBreakingChanges(doc(), next)).toContain(
      'POST /things 201.data.tags[]: response type gained integer',
    )
  })

  it('flags a newly required or removed request field, narrowed types and enums', () => {
    const next = doc({
      body: {
        type: 'object',
        required: ['name', 'kind'],
        properties: {
          name: { type: 'integer' },
          kind: { type: 'string', enum: ['A'] },
        },
      },
    })
    expect(findBreakingChanges(doc(), next)).toEqual([
      'POST /things body.name: no longer accepts string',
      'POST /things body.kind: no longer accepts "B"',
      'POST /things body.kind: newly required',
    ])
  })

  it('flags request body changes: removed, newly required, content type dropped', () => {
    const optional = doc({ bodyRequired: false })
    expect(findBreakingChanges(doc(), doc({ body: null }))).toEqual([
      'POST /things: request body removed',
    ])
    expect(findBreakingChanges(optional, doc())).toEqual([
      'POST /things: request body newly required',
    ])
    expect(findBreakingChanges(doc({ body: null }), doc())).toEqual([
      'POST /things: request body newly required',
    ])
    expect(findBreakingChanges(doc({ body: null }), optional)).toEqual([])
    expect(findBreakingChanges(doc(), doc({ bodyType: 'text/csv' }))).toEqual([
      'POST /things: request application/json no longer accepted',
    ])
  })

  it('flags parameter changes', () => {
    const removed = doc({ params: [] })
    expect(findBreakingChanges(doc(), removed)).toEqual([
      'GET /things: parameter query:limit removed',
    ])
    const required = doc({
      params: [
        { name: 'limit', in: 'query', schema: { type: 'integer' } },
        { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
      ],
    })
    expect(findBreakingChanges(doc(), required)).toEqual([
      'GET /things: parameter query:q newly required',
    ])
    const retyped = doc({
      params: [{ name: 'limit', in: 'query', schema: { type: 'boolean' } }],
    })
    expect(findBreakingChanges(doc(), retyped)).toEqual([
      'GET /things query:limit: no longer accepts integer',
    ])
    const viaRef = doc({ params: [{ $ref: '#/components/parameters/Limit' }] })
    ;(viaRef.components as Record<string, JsonSchema>).parameters = {
      Limit: { name: 'limit', in: 'query', schema: { type: 'integer' } },
    }
    expect(findBreakingChanges(doc(), viaRef)).toEqual([])
    const noSchema = doc({ params: [{ name: 'limit', in: 'query' }] })
    expect(findBreakingChanges(noSchema, noSchema)).toEqual([])
  })

  it('flags a removed success status or content type, ignores error responses', () => {
    const base = doc()
    const noSuccess = doc({ getResponses: { 401: { description: 'x' } } })
    expect(findBreakingChanges(base, noSuccess)).toEqual([
      'GET /things: response 200 removed',
    ])
    const csv = doc({
      getResponses: {
        200: { content: { 'text/csv': { schema: { type: 'string' } } } },
      },
    })
    expect(findBreakingChanges(base, csv)).toEqual([
      'GET /things: response 200 application/json removed',
    ])
    const withoutErrors = doc({
      getResponses: {
        200: (base.paths as any)['/things'].get.responses[200],
      },
    })
    expect(findBreakingChanges(base, withoutErrors)).toEqual([])
  })

  it('reads unions: nullable members, object members and their required keys', () => {
    const union = (members: JsonSchema[]) =>
      doc({
        thing: {
          oneOf: members,
        },
      })
    const a = {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
    }
    const b = {
      type: 'object',
      required: ['id', 'code'],
      properties: { id: { type: 'string' }, code: { type: 'string' } },
    }
    expect(findBreakingChanges(union([a, b]), union([a, b]))).toEqual([])
    // `code` is required only in the first member: not always present.
    expect(findBreakingChanges(union([b, a]), union([b, a]))).toEqual([])
    // `code` was never required in every member: dropping it from `b` only
    // removes the field.
    expect(
      findBreakingChanges(
        union([a, b]),
        union([a, { ...a, required: ['id'] }]),
      ),
    ).toEqual([
      'GET /things 200.data.items[].code: removed',
      'POST /things 201.data.code: removed',
    ])
    const enums = (values: string[][]) =>
      doc({
        thing: { anyOf: values.map((v) => ({ type: 'string', enum: v })) },
      })
    expect(
      findBreakingChanges(enums([['A'], ['B']]), enums([['A'], ['B', 'C']])),
    ).toEqual([])
    const untyped = doc({ thing: { anyOf: [{}, { type: 'null' }] } })
    expect(findBreakingChanges(untyped, doc())).toEqual([])
  })

  it('reads const values and untyped schemas without false alarms', () => {
    const constant = (value: unknown) =>
      doc({ thing: { type: 'object', properties: { flag: { const: value } } } })
    expect(findBreakingChanges(constant(true), constant(false))).toEqual([])
    expect(findBreakingChanges(constant(true), constant('yes'))).toContain(
      'POST /things 201.data.flag: response type gained string',
    )
    expect(findBreakingChanges(constant(null), constant([1]))).toContain(
      'POST /things 201.data.flag: response type gained array',
    )
    const enumOnly = doc({ thing: { enum: [1, 'a'] } })
    expect(findBreakingChanges(enumOnly, enumOnly)).toEqual([])
    const multi = doc({ thing: { type: ['string', 'null'] } })
    expect(
      findBreakingChanges(multi, doc({ thing: { type: 'string' } })),
    ).toEqual([])
  })

  it('survives self-referencing and dangling $refs', () => {
    const cyclic = doc({
      thing: {
        type: 'object',
        properties: { parent: { $ref: '#/components/schemas/Thing' } },
      },
    })
    expect(findBreakingChanges(cyclic, cyclic)).toEqual([])
    const loop = doc({ thing: { $ref: '#/components/schemas/Thing' } })
    expect(findBreakingChanges(loop, loop)).toEqual([])
    const dangling = doc({ thing: { $ref: '#/components/schemas/Missing' } })
    expect(findBreakingChanges(dangling, dangling)).toEqual([])
    const deep = doc({ thing: { $ref: '#/components/nothing/here/Thing' } })
    expect(findBreakingChanges(deep, deep)).toEqual([])
    const selfAllOf = doc({
      thing: { allOf: [{ $ref: '#/components/schemas/Thing' }] },
    })
    expect(findBreakingChanges(selfAllOf, selfAllOf)).toEqual([])
  })

  it('tolerates documents without paths and operations without parts', () => {
    expect(findBreakingChanges({}, {})).toEqual([])
    const noContent = doc({ getResponses: { 200: { description: 'ok' } } })
    expect(findBreakingChanges(noContent, noContent)).toEqual([])
    const noSchema = doc({
      getResponses: { 200: { content: { 'application/json': {} } } },
    })
    expect(findBreakingChanges(noSchema, noSchema)).toEqual([])
    const bare = { paths: { '/x': { get: {}, parameters: [] } } }
    expect(findBreakingChanges(bare, bare)).toEqual([])
  })
})
