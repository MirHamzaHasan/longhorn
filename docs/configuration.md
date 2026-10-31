# Configuration

`@longhornjs/config` validates supplied records with Standard Schema. It does not read
files, access environment globals, or choose a schema vendor. Node environment access
lives in `@longhornjs/node/config`.

## Typed settings

```ts
import { loadConfig } from '@longhornjs/config'
import { readEnv } from '@longhornjs/node/config'
import { z } from 'zod'

const schema = z.object({
  PORT: z.string().regex(/^\d+$/).default('3000')
    .transform(Number).pipe(z.number().int().min(0).max(65535)),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
}).transform(({ PORT, HOST }) => ({ port: PORT, hostname: HOST }))

const environment = await readEnv({ files: ['.env', '.env.local'], ignoreMissing: true })
const config = await loadConfig(schema, environment)
// Readonly<{ port: number; hostname: string }>
```

`loadConfig(schema, ...sources)` merges records in order. Later defined values win.
`undefined` is skipped; empty strings, zero, false, and null are supplied values and
are validated normally. Merging is shallow: a later nested object replaces the earlier
one. Defaults, transformations, and unknown-key handling belong to the schema.

The validated top-level output is frozen and typed as `Readonly<Output>`. Nested
values are not recursively frozen or cloned. The loader does not change source
records. Both synchronous and asynchronous schemas are supported.

## Node environment files

Requires Node.js 20.19.0+, matching the Node adapter's engine requirement.

`readEnv({ files, env, ignoreMissing })` reads files in order, then overlays a snapshot
of `process.env` (or the supplied `env` record). Process values take precedence over
file values, including explicitly empty strings. Undefined values are skipped.

File paths can be strings or file URLs; relative strings use the working directory.
No files are read unless `files` is supplied. `ignoreMissing` defaults to false;
enabling it skips only missing files. Other file errors still reject.

The helper uses Node's built-in `parseEnv` for quotes, comments, and multiline values.
It does not change `process.env`, execute values, or expand variable references. The
environment snapshot is captured at call time, before file reads are awaited, and is
frozen before being returned.

Supply an explicit source for deterministic tests:

```ts
const environment = await readEnv({ env: { HOST: '127.0.0.1', PORT: '0' } })
```

## Startup errors

Schema failures throw `ConfigError`, which extends `ValidationError`:

```ts
import { ConfigError, loadConfig } from '@longhornjs/config'

try {
  const config = await loadConfig(schema, environment)
  // Start the application only after configuration succeeds.
} catch (error) {
  if (error instanceof ConfigError) console.error(error.message)
  else throw error
}
```

The summary identifies failed fields, for example `Invalid configuration: PORT`.
It contains no configuration values or schema messages. Detailed normalized
diagnostics remain in `error.issues`; those messages are supplied by the schema and
may include values if the schema author puts them there. Exceptions thrown by schema
code remain application errors rather than becoming configuration failures.

## Application services

Keep configuration in an application-owned DI provider:

```ts
import { Longhorn } from '@longhornjs/core'
import { provide, token } from '@longhornjs/container'

const Settings = token<typeof config>('settings')
const app = new Longhorn()
app.container.register(provide(Settings, { factory: () => config }))
app.http.get('/info', (c) => {
  const settings = c.get('container').resolve(Settings)
  return c.json({ port: settings.port })
})
```

Core does not import configuration or a schema library. Other runtimes can supply
their own records to the same loader.

The basic example loads optional `.env` and `.env.local` files from `examples/basic/`
in both source and built execution. Copy `.env.example` there to get started. It
validates `APP_NAME`, `HOST`, `PORT`, `LOG_LEVEL`, and `DATABASE_PATH` before creating the app or binding a socket,
registers typed settings in DI, and exits with status 1 on invalid configuration.
An explicit `PORT=0` requests an ephemeral port; blank, fractional, negative,
out-of-range, and non-decimal ports are rejected.

`LOG_LEVEL` accepts `debug`, `info`, `warn`, `error`, or `silent` and defaults to
`info`. Validated settings choose the [logger](logging.md); the host then delegates
startup and shutdown to the [application lifecycle](lifecycle.md).

`DATABASE_PATH` defaults to `./data/longhorn.sqlite`, resolved by the example host
relative to `examples/basic/`. Absolute filenames and explicit `:memory:` are
supported. Configuration validation does not open the file; the
[SQLite lifecycle hook](sqlite.md) does that after settings validate.

## Verification

[Configuration tests](../packages/config/src/config.test.ts) cover merging, defaults,
typed output, field-only summaries, async schemas, and source isolation.
[Node environment tests](../runtimes/node/src/config.test.ts) use real temporary files
to verify precedence, snapshots, missing-file policy, and process isolation.
[Example tests](../examples/basic/src/config.test.ts) verify startup settings and DI.
