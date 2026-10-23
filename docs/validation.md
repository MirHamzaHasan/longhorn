# Validation

Connections: [HTTP](http.md), [configuration](configuration.md), and
[the tasks example](tasks-example.md). The root API is independent of HTTP.

`@longhorn/validation` accepts Standard Schema-compatible schemas. The package does
not choose a schema library for applications. The basic example uses Zod.

## Validate requests

```ts
import { Longhorn } from '@longhorn/core'
import { validate } from '@longhorn/validation/hono'
import { z } from 'zod'

const app = new Longhorn()
const createTask = z.object({ title: z.string().trim().min(1).max(200) })

app.http.post('/tasks', validate('json', createTask), (c) => {
  const body = c.req.valid('json') // { title: string }, already trimmed
  return c.json({ title: body.title }, 201)
})
```

`validate(target, schema)` delegates to Hono's Standard Schema validator. Hono owns
request parsing, middleware composition, and the input/output types. LongHorn supplies
the public error shape. Validation can transform values, set defaults, and run async
refinements; handlers receive the schema's output through `c.req.valid(target)`.

Supported targets are `json`, `query`, `param`, `form`, `header`, and `cookie`.

```ts
app.http.get('/tasks/:id',
  validate('param', z.object({ id: z.coerce.number().int().positive() })),
  validate('query', z.object({ page: z.coerce.number().int().positive().default(1) })),
  (c) => {
    const { id } = c.req.valid('param')     // number
    const { page } = c.req.valid('query')   // number
    return c.json({ id, page })
  },
)
```

Validators for different targets compose on the same route. Header names use Hono's
lowercase keys. Repeated query keys become arrays; a single query value is a string.
Use a schema that accepts the expected shape.

For JSON and form requests, send the appropriate `Content-Type`. Hono only parses
compatible media types; otherwise the schema receives an empty object. Required
fields then fail validation, while optional fields and defaults follow the schema.
JSON clients should send `Content-Type: application/json` (vendor `+json` types are
also supported). The example's create and update routes require JSON fields.

## Errors

Schema failures return status **400** and stop execution before the route handler:

```json
{
  "error": "Validation failed",
  "target": "json",
  "issues": [
    { "message": "Title is required", "path": ["title"] }
  ]
}
```

Paths retain nested object keys and array indexes. Root-level issues use `[]`.
Standard Schema path objects are reduced to their keys; symbols become strings.
Only `message` and `path` are copied from schema issues. The raw input object and
vendor-specific issue properties are not returned. Schema messages are used as supplied.

Malformed JSON is rejected by Hono before schema validation. LongHorn's default HTTP
error handler returns status 400 with:

```json
{ "error": "Malformed JSON in request body" }
```

Exceptions thrown by schema code remain application errors and reach the HTTP error
handler. They are not reported as ordinary validation failures. Explicit Hono error
responses retain their status, body, and headers. Message-only `HTTPException` errors
use `{ "error": "..." }` JSON by default.

## Validate outside HTTP

The root entrypoint has no HTTP imports, so schemas can be reused for configuration,
job inputs, or application services:

```ts
import { parse, safeParse, ValidationError } from '@longhorn/validation'
import { z } from 'zod'

const settings = z.object({ port: z.coerce.number().int().min(1).max(65535) })

const config = await parse(settings, { port: '3000' }) // { port: number }

const result = await safeParse(settings, { port: 'invalid' })
if (result.success) {
  console.log(result.data)
} else {
  console.log(result.issues)
}

try {
  await parse(settings, {})
} catch (error) {
  if (error instanceof ValidationError) console.log(error.issues)
  else throw error
}
```

Both helpers always return promises and support sync and async schemas. `parse`
throws `ValidationError` for schema issues; `safeParse` returns a discriminated
`{ success, data | issues }` result. Exceptions from the schema implementation propagate
through both helpers. Standard Schema types are re-exported for applications that
provide their own compliant schemas.

## Verification

[Schema tests](../packages/validation/src/schema.test.ts) cover inferred transforms,
async validation, vendor-independent schemas, issue normalization, and programmer
errors. [Hono tests](../packages/validation/src/hono.test.ts) cover each target,
composed validators, media types, and error responses.
