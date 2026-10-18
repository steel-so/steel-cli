export type JsonSchema = { [key: string]: unknown }

/**
 * Breaking-change check of the Steel public API v1 document, ported from
 * the Steel repo (`src/openapi/v1/compat.ts`, ADR 0035) — keep the two in
 * sync. Here it compares the snapshot the SDK was generated from with the
 * document a live Steel serves (the release contract test, ADR 0034) and
 * lists what would break this SDK and CLI. Additive changes (new
 * routes, new optional inputs, new response fields, new error codes) pass.
 *
 * Breaking:
 * - a path or operation removed, or a success status removed;
 * - a response field removed, made optional, or with a type it did not
 *   have (including becoming nullable);
 * - a request field or parameter removed, newly required, or accepting
 *   fewer types or enum values;
 * - a request body or content type that was accepted no longer is.
 */

type Direction = 'request' | 'response'

interface Shape {
  /** `null` = no type information (any). */
  types: Set<string> | null
  properties: Record<string, JsonSchema>
  required: Set<string>
  items: JsonSchema | null
  enum: unknown[] | null
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head']

const isObject = (value: unknown): value is JsonSchema =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function resolveRef(node: unknown, doc: JsonSchema): JsonSchema {
  let current = node
  const seen = new Set<string>()
  while (isObject(current) && typeof current.$ref === 'string') {
    const ref = current.$ref
    if (seen.has(ref)) break
    seen.add(ref)
    const parts = ref.replace(/^#\//, '').split('/')
    let target: unknown = doc
    for (const part of parts)
      target = isObject(target) ? target[part] : undefined
    current = target
  }
  return isObject(current) ? current : {}
}

function typesOf(schema: JsonSchema): Set<string> | null {
  if (typeof schema.type === 'string') return new Set([schema.type])
  if (Array.isArray(schema.type)) return new Set(schema.type as string[])
  if ('const' in schema) return new Set([jsonType(schema.const)])
  if (Array.isArray(schema.enum)) return new Set(schema.enum.map(jsonType))
  return null
}

function jsonType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (Number.isInteger(value)) return 'integer'
  return typeof value
}

/** Flattens `$ref`, `allOf` and `anyOf`/`oneOf` into one comparable shape. */
function shapeOf(node: unknown, doc: JsonSchema, depth = 0): Shape {
  const schema = resolveRef(node, doc)
  const shape: Shape = {
    types: typesOf(schema),
    properties: isObject(schema.properties)
      ? { ...(schema.properties as Record<string, JsonSchema>) }
      : {},
    required: new Set(
      Array.isArray(schema.required) ? (schema.required as string[]) : [],
    ),
    items: isObject(schema.items) ? schema.items : null,
    enum: Array.isArray(schema.enum) ? schema.enum : null,
  }
  if (depth > 20) return shape

  for (const part of (schema.allOf as unknown[] | undefined) ?? []) {
    const inner = shapeOf(part, doc, depth + 1)
    Object.assign(shape.properties, inner.properties)
    for (const key of inner.required) shape.required.add(key)
    shape.types ??= inner.types
    shape.items ??= inner.items
    shape.enum ??= inner.enum
  }

  const union = [
    ...((schema.anyOf as unknown[] | undefined) ?? []),
    ...((schema.oneOf as unknown[] | undefined) ?? []),
  ]
  if (union.length > 0) {
    const members = union.map((part) => shapeOf(part, doc, depth + 1))
    const types = new Set<string>(shape.types ?? [])
    let untyped = false
    for (const member of members) {
      if (member.types === null) untyped = true
      for (const type of member.types ?? []) types.add(type)
      for (const [key, value] of Object.entries(member.properties)) {
        shape.properties[key] ??= value
      }
      shape.items ??= member.items
    }
    // Required only when every object member requires it.
    const objects = members.filter((member) => member.types?.has('object'))
    if (objects.length > 0) {
      for (const key of objects[0]?.required ?? []) {
        if (objects.every((member) => member.required.has(key))) {
          shape.required.add(key)
        }
      }
    }
    const enums = members.map((member) => member.enum)
    shape.enum = enums.every((values) => values !== null)
      ? enums.flatMap((values) => values as unknown[])
      : null
    shape.types = untyped ? null : types
  }
  return shape
}

/** `integer` values are also `number`s. */
function covers(types: Set<string>, type: string): boolean {
  return types.has(type) || (type === 'integer' && types.has('number'))
}

function compareSchemas(
  where: string,
  base: unknown,
  next: unknown,
  docs: { base: JsonSchema; next: JsonSchema },
  direction: Direction,
  out: string[],
  depth = 0,
): void {
  if (depth > 25) return
  const a = shapeOf(base, docs.base)
  const b = shapeOf(next, docs.next)

  if (a.types && b.types) {
    if (direction === 'response') {
      const added = [...b.types].filter(
        (type) => !covers(a.types as Set<string>, type),
      )
      if (added.length > 0) {
        out.push(`${where}: response type gained ${added.join(', ')}`)
      }
    } else {
      const lost = [...a.types].filter(
        (type) => !covers(b.types as Set<string>, type),
      )
      if (lost.length > 0) {
        out.push(`${where}: no longer accepts ${lost.join(', ')}`)
      }
    }
  }

  if (direction === 'request' && a.enum && b.enum) {
    const lost = a.enum.filter(
      (value) =>
        !b.enum?.some((item) => JSON.stringify(item) === JSON.stringify(value)),
    )
    if (lost.length > 0) {
      out.push(
        `${where}: no longer accepts ${lost.map((v) => JSON.stringify(v)).join(', ')}`,
      )
    }
  }

  for (const [key, schema] of Object.entries(a.properties)) {
    const field = `${where}.${key}`
    if (!(key in b.properties)) {
      out.push(`${field}: removed`)
      continue
    }
    if (
      direction === 'response' &&
      a.required.has(key) &&
      !b.required.has(key)
    ) {
      out.push(`${field}: no longer always present`)
    }
    compareSchemas(
      field,
      schema,
      b.properties[key],
      docs,
      direction,
      out,
      depth + 1,
    )
  }
  if (direction === 'request') {
    for (const key of b.required) {
      if (!a.required.has(key)) out.push(`${where}.${key}: newly required`)
    }
  }

  if (a.items && b.items) {
    compareSchemas(
      `${where}[]`,
      a.items,
      b.items,
      docs,
      direction,
      out,
      depth + 1,
    )
  }
}

interface Parameter {
  name: string
  in: string
  required?: boolean
  schema?: JsonSchema
}

function parametersOf(
  operation: JsonSchema,
  doc: JsonSchema,
): Map<string, Parameter> {
  const params = new Map<string, Parameter>()
  for (const raw of (operation.parameters as unknown[] | undefined) ?? []) {
    const param = resolveRef(raw, doc) as unknown as Parameter
    params.set(`${param.in}:${param.name}`, param)
  }
  return params
}

function jsonContent(
  holder: JsonSchema,
  doc: JsonSchema,
): Record<string, JsonSchema> {
  const resolved = resolveRef(holder, doc)
  return isObject(resolved.content)
    ? (resolved.content as Record<string, JsonSchema>)
    : {}
}

function compareOperation(
  where: string,
  base: JsonSchema,
  next: JsonSchema,
  docs: { base: JsonSchema; next: JsonSchema },
  out: string[],
): void {
  const baseParams = parametersOf(base, docs.base)
  const nextParams = parametersOf(next, docs.next)
  for (const [key, param] of baseParams) {
    const other = nextParams.get(key)
    if (!other) {
      out.push(`${where}: parameter ${key} removed`)
      continue
    }
    compareSchemas(
      `${where} ${key}`,
      param.schema,
      other.schema,
      docs,
      'request',
      out,
    )
  }
  for (const [key, param] of nextParams) {
    if (param.required && !baseParams.get(key)?.required) {
      out.push(`${where}: parameter ${key} newly required`)
    }
  }

  const baseBody = isObject(base.requestBody) ? base.requestBody : null
  const nextBody = isObject(next.requestBody) ? next.requestBody : null
  if (nextBody && !baseBody && resolveRef(nextBody, docs.next).required) {
    out.push(`${where}: request body newly required`)
  }
  if (baseBody && nextBody) {
    if (
      !resolveRef(baseBody, docs.base).required &&
      resolveRef(nextBody, docs.next).required
    ) {
      out.push(`${where}: request body newly required`)
    }
    const nextContent = jsonContent(nextBody, docs.next)
    for (const [type, media] of Object.entries(
      jsonContent(baseBody, docs.base),
    )) {
      if (!nextContent[type]) {
        out.push(`${where}: request ${type} no longer accepted`)
        continue
      }
      compareSchemas(
        `${where} body`,
        media.schema,
        nextContent[type].schema,
        docs,
        'request',
        out,
      )
    }
  } else if (baseBody && !nextBody) {
    out.push(`${where}: request body removed`)
  }

  const baseResponses = (base.responses ?? {}) as Record<string, JsonSchema>
  const nextResponses = (next.responses ?? {}) as Record<string, JsonSchema>
  for (const [status, response] of Object.entries(baseResponses)) {
    if (!/^2\d\d$/.test(status)) continue
    const other = nextResponses[status]
    if (!other) {
      out.push(`${where}: response ${status} removed`)
      continue
    }
    const nextContent = jsonContent(other, docs.next)
    for (const [type, media] of Object.entries(
      jsonContent(response, docs.base),
    )) {
      if (!nextContent[type]) {
        out.push(`${where}: response ${status} ${type} removed`)
        continue
      }
      compareSchemas(
        `${where} ${status}`,
        media.schema,
        nextContent[type].schema,
        docs,
        'response',
        out,
      )
    }
  }
}

/** Breaking changes from `base` to `next` (empty = compatible). */
export function findBreakingChanges(
  base: JsonSchema,
  next: JsonSchema,
): string[] {
  const out: string[] = []
  const docs = { base, next }
  const basePaths = (base.paths ?? {}) as Record<string, JsonSchema>
  const nextPaths = (next.paths ?? {}) as Record<string, JsonSchema>
  for (const [path, item] of Object.entries(basePaths)) {
    for (const method of HTTP_METHODS) {
      const operation = item[method]
      if (!isObject(operation)) continue
      const where = `${method.toUpperCase()} ${path}`
      const other = nextPaths[path]?.[method]
      if (!isObject(other)) {
        out.push(`${where}: removed`)
        continue
      }
      compareOperation(where, operation, other, docs, out)
    }
  }
  return [...new Set(out)]
}
