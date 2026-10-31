export const runtimes = ['node', 'bun', 'deno', 'workers'] as const
export const templates = ['api', 'd1-tasks', 'sqlite-tasks', 'sqlite-auth', 'command-app'] as const
export type ProjectTemplate = typeof templates[number]
export type ProjectRuntime = typeof runtimes[number]

const app = `import { Longhorn } from '@longhornjs/core'
import { provide, token } from '@longhornjs/container'
import { EventBus, defineEvent } from '@longhornjs/events'
import { Cache } from '@longhornjs/cache'
import { MemoryCacheStore } from '@longhornjs/cache/memory'
import type { Logger } from '@longhornjs/logger'
import { validate } from '@longhornjs/validation/hono'
import { z } from 'zod'
import { configureDiagnostics } from './diagnostics.js'

export type Bindings = { GREETING?: string }
const State = token<{ ready: boolean }>('application state')
const Events = token<EventBus>('application events')
const Echoed = defineEvent<void>('app.echoed')
type Profile = { readonly runtime: string; readonly generatedAt: string }
const ProfileCache = token<Cache<Profile>>('public profile cache')

export function createApp(runtime: string, greeting = 'Hello from LongHorn', logger?: Logger) {
  const state = { ready: false }
  const activity = { echoes: 0, requestId: null as string | null }
  const app = new Longhorn<Bindings>(logger ? { logger } : {})
  app.container.register(provide(State, { factory: () => state }))
  app.container.register(provide(Events, { factory: () => new EventBus() }))
  app.container.register(provide(ProfileCache, { factory: () => new Cache<Profile>(new MemoryCacheStore<Profile>(), { ttlMs: 5000 }) }))
  app.onStart(() => {
    state.ready = true
    return () => { state.ready = false }
  })
  app.onStart(() => {
    const cache = app.container.resolve(ProfileCache)
    return () => cache.close()
  })
  app.onStart(() => {
    const events = app.container.resolve(Events)
    const scope = events.scope()
    scope.on(Echoed, async (_, context) => {
      await Promise.resolve()
      activity.echoes++
      activity.requestId = context.correlationId ?? null
    })
    return () => events.close()
  })
  configureDiagnostics(app, () => state.ready)
  app.http.get('/health', (c) => c.json({ status: 'ok', runtime, ...c.get('container').resolve(State) }))
  app.http.get('/', (c) => c.json({ greeting: c.env?.GREETING ?? greeting, runtime }))
  app.http.get('/events', (c) => c.json({ events: { ...activity } }))
  app.http.get('/cached', async (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json(await c.get('container').resolve(ProfileCache).getOrLoad('profile', async () => ({ runtime, generatedAt: new Date().toISOString() })))
  })
  app.http.post('/cached/invalidate', async (c) => { await c.get('container').resolve(ProfileCache).delete('profile'); return c.body(null, 204) })
  app.http.post('/echo', validate('json', z.object({ message: z.string().trim().min(1).max(200) })), async (c) => {
    await c.get('container').resolve(Events).emit(Echoed, undefined, { correlationId: c.get('requestId') })
    return c.json({ message: c.req.valid('json').message })
  })
  return app
}
`

const diagnostics = `import type { Longhorn } from '@longhornjs/core'
import { provide, token } from '@longhornjs/container'
import { MetricRegistry, Readiness, Tracer } from '@longhornjs/observability'
import { MemorySpanExporter } from '@longhornjs/observability/memory'
import { httpTelemetry, livenessHandler, readinessHandler, requestSpan } from '@longhornjs/observability/hono'
import { PROMETHEUS_CONTENT_TYPE, renderPrometheus } from '@longhornjs/observability/prometheus'

export const Diagnostics = token<{ meter: MetricRegistry; readiness: Readiness; tracer: Tracer }>('portable diagnostics')
export function configureDiagnostics<Bindings extends object>(app: Longhorn<Bindings>, ready: () => boolean) {
  const meter = new MetricRegistry(), readiness = new Readiness(), exporter = new MemorySpanExporter()
  const tracer = new Tracer({ exporter })
  app.container.register(provide(Diagnostics, { factory: () => ({ meter, readiness, tracer }) }))
  readiness.add('application', ready)
  const telemetry = httpTelemetry({ meter, tracer, excludePaths: ['/metrics', '/traces'] })
  app.http.use('*', telemetry.middleware)
  app.http.use('*', async (c, next) => {
    const span = requestSpan(c)
    if (span) c.set('logger', c.get('logger').child({ traceId: span.context.traceId, spanId: span.context.spanId }))
    await next()
  })
  app.http.get('/livez', livenessHandler(() => app.state !== 'failed' && app.state !== 'stopped'))
  app.http.get('/readyz', readinessHandler(readiness))
  app.http.get('/metrics', (c) => { c.header('Cache-Control', 'no-store'); c.header('Content-Type', PROMETHEUS_CONTENT_TYPE); return c.body(renderPrometheus(meter.snapshot())) })
  app.http.get('/traces', async (c) => { await tracer.flush(); c.header('Cache-Control', 'no-store'); return c.json({ spans: exporter.snapshot(), stats: tracer.snapshot() }) })
  app.onStart(() => { readiness.start(); return () => readiness.close() })
  app.onStop(async () => { try { await readiness.close(); await tracer.close() } finally { meter.close() } })
  return { meter, readiness, tracer }
}
`

const config = `import { z } from 'zod'

export const serverConfig = z.object({
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.string().trim().regex(/^\\d+$/).default('3000').transform(Number)
    .pipe(z.number().int().min(0).max(65535)),
  GREETING: z.string().trim().min(1).default('Hello from LongHorn'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
}).transform(({ HOST, PORT, GREETING, LOG_LEVEL }) => ({
  hostname: HOST, port: PORT, greeting: GREETING, logLevel: LOG_LEVEL,
}))
`

function nativeEntry(runtime: Exclude<ProjectRuntime, 'workers'>): string {
  const environment = runtime === 'node'
    ? "await readEnv({ files: ['.env', '.env.local'], ignoreMissing: true })"
    : runtime === 'bun'
      ? '{ HOST: Bun.env.HOST, PORT: Bun.env.PORT, GREETING: Bun.env.GREETING, LOG_LEVEL: Bun.env.LOG_LEVEL }'
      : "Object.fromEntries(['HOST', 'PORT', 'GREETING', 'LOG_LEVEL'].map((key) => [key, Deno.env.get(key)]))"
  const signals = runtime === 'deno'
    ? "Deno.addSignalListener('SIGINT', shutdown)\nDeno.addSignalListener('SIGTERM', shutdown)"
    : "process.on('SIGINT', shutdown)\nprocess.on('SIGTERM', shutdown)"
  const cleanup = runtime === 'deno'
    ? " finally {\n    Deno.removeSignalListener('SIGINT', shutdown)\n    Deno.removeSignalListener('SIGTERM', shutdown)\n  }"
    : ''
  return `import { loadConfig } from '@longhornjs/config'
import { ${runtime}Runtime } from '@longhornjs/${runtime}'
${runtime === 'node' ? "import { readEnv } from '@longhornjs/node/config'\n" : ''}import { createLogger } from '@longhornjs/logger'
import { createApp } from './app.js'
import { serverConfig } from './config.js'

const config = await loadConfig(serverConfig, ${environment})
const logger = createLogger({ level: config.logLevel, bindings: { runtime: '${runtime}' } })
const app = createApp('${runtime}', config.greeting, logger)
  .onStop(() => { logger.info('Application stopped') })
const server = await app.listen(${runtime}Runtime, { hostname: config.hostname, port: config.port })
logger.info('HTTP server listening', { url: server.url })

let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  try { await app.close() } catch (error) {
    logger.error('Application shutdown failed', { error })
    ${runtime === 'deno' ? 'Deno.exitCode' : 'process.exitCode'} = 1
  }${cleanup}
${runtime === 'bun' ? '  // Stop the native watcher after application resources have closed.\n  process.exit(process.exitCode ?? 0)' : runtime === 'deno' ? '  // Stop the native watcher after application resources have closed.\n  Deno.exit(Deno.exitCode)' : ''}
}
${signals}
`
}

const workerEntry = `import { createScheduledWorker } from '@longhornjs/workers/scheduled'
import { createLogger } from '@longhornjs/logger'
import { createApp } from './app.js'
import type { Bindings } from './app.js'
import { Diagnostics } from './diagnostics.js'

const logger = createLogger({ bindings: { runtime: 'workers' } })
const app = createApp('workers', 'Hello from LongHorn', logger)
const observations = { runs: 0, lastScheduledTime: null as number | null, lastCron: null as string | null }
app.http.get('/scheduled', (c) => { c.header('Cache-Control', 'no-store'); return c.json({ ...observations }) })
export default createScheduledWorker<Bindings>(app, { handle: async ({ controller, signal }) => {
  const tracer = app.container.resolve(Diagnostics).tracer
  try {
    await tracer.trace('worker.scheduled', () => {
      signal.throwIfAborted()
      observations.runs++
      observations.lastScheduledTime = controller.scheduledTime
      observations.lastCron = controller.cron
    }, { kind: 'consumer' })
  } finally { await tracer.flush() }
} })
`

const workerHost = `import { Miniflare, Log, LogLevel } from 'miniflare'
import { context } from 'esbuild'
import { createLogger } from '@longhornjs/logger'
import { resolveServeOptions } from '@longhornjs/runtime'
import { fileURLToPath } from 'node:url'
import { buildOptions } from './build.config.mjs'

const port = process.env.PORT ?? '3000'
if (!/^\\d+$/.test(port.trim())) throw new Error('PORT must be a decimal integer')
const options = resolveServeOptions({ hostname: process.env.HOST ?? '127.0.0.1', port: Number(port) })
const logger = createLogger({ bindings: { runtime: 'workers-local' } })
const signals = ['SIGINT', 'SIGTERM']
const previous = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]))
const workerOptions = {
  modules: true, scriptPath: fileURLToPath(new URL('./dist/index.js', import.meta.url)),
  compatibilityDate: '2025-07-18', host: options.hostname, port: options.port, cf: false,
  bindings: { GREETING: process.env.GREETING ?? 'Hello from LongHorn' }, log: new Log(LogLevel.WARN),
}
const worker = new Miniflare(workerOptions)
// This host awaits disposal instead of using Miniflare 3's synchronous signal exit.
for (const signal of signals) {
  for (const listener of process.listeners(signal)) {
    if (!previous.get(signal).has(listener)) process.removeListener(signal, listener)
  }
}
try {
  const address = await worker.ready
  workerOptions.port = Number(address.port)
  logger.info('HTTP server listening', { url: String(address).replace(/\\/$/, '') })
}
catch (error) { await worker.dispose(); throw error }

let closing = false
let watcher
if (process.argv.includes('--watch')) {
  try {
    watcher = await context({ ...buildOptions, plugins: [{
      name: 'reload-worker',
      setup(builder) {
        builder.onEnd(async (result) => {
          if (closing || result.errors.length) return
          try { await worker.setOptions(workerOptions); logger.info('Worker reloaded') }
          catch (error) { logger.error('Worker reload failed', { error }) }
        })
      },
    }] })
    await watcher.watch()
  } catch (error) { await watcher?.dispose(); await worker.dispose(); throw error }
}
async function shutdown() {
  if (closing) return
  closing = true
  try {
    const errors = []
    try { await watcher?.dispose() } catch (error) { errors.push(error) }
    try { await worker.dispose() } catch (error) { errors.push(error) }
    if (errors.length) throw new AggregateError(errors, 'Local worker cleanup failed')
    logger.info('Application stopped')
  }
  catch (error) { logger.error('Local worker shutdown failed', { error }); process.exitCode = 1 }
}
for (const signal of signals) process.on(signal, shutdown)
`

const appTest = `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApp } from './app.js'

test('startup, DI, bindings, validation, and JSON errors work through Fetch', async () => {
  const app = createApp('test')
  try {
    const health = await app.fetch(new Request('http://localhost/health'))
    assert.deepEqual(await health.json(), { status: 'ok', runtime: 'test', ready: true })
    assert.ok(health.headers.get('X-Request-Id'))
    assert.ok(health.headers.get('traceparent'))
    assert.equal((await app.fetch(new Request('http://localhost/livez'))).status, 200)
    assert.equal((await app.fetch(new Request('http://localhost/readyz'))).status, 200)
    const metrics = await app.fetch(new Request('http://localhost/metrics'))
    assert.ok((await metrics.text()).includes('longhorn_http_requests_total'))
    const traces = await app.fetch(new Request('http://localhost/traces'))
    assert.ok((await traces.json()).spans.length > 0)
    const greeting = await app.fetch(new Request('http://localhost/'))
    assert.deepEqual(await greeting.json(), { greeting: 'Hello from LongHorn', runtime: 'test' })
    const bound = await app.fetch(new Request('http://localhost/'), { GREETING: 'A bound greeting' })
    assert.equal((await bound.json()).greeting, 'A bound greeting')
    const echo = await app.fetch(new Request('http://localhost/echo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"message":"  hello  "}',
    }))
    assert.deepEqual(await echo.json(), { message: 'hello' })
    const activity = await app.fetch(new Request('http://localhost/events'))
    assert.deepEqual(await activity.json(), { events: { echoes: 1, requestId: echo.headers.get('X-Request-Id') } })
    const profile = await app.fetch(new Request('http://localhost/cached'))
    const cached = await profile.json()
    assert.equal(cached.runtime, 'test')
    assert.equal(profile.headers.get('Cache-Control'), 'no-store')
    assert.deepEqual(await (await app.fetch(new Request('http://localhost/cached'))).json(), cached)
    assert.equal((await app.fetch(new Request('http://localhost/cached/invalidate', { method: 'POST' }))).status, 204)
    const invalid = await app.fetch(new Request('http://localhost/echo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"message":""}',
    }))
    assert.equal(invalid.status, 400)
    assert.equal((await invalid.json()).error, 'Validation failed')
    assert.equal((await app.fetch(new Request('http://localhost/missing'))).status, 404)
  } finally { await app.close() }
})
`

export function projectFiles(
  name: string, runtime: ProjectRuntime, dependencies: Record<string, string>, locations: Record<string, string>,
): Record<string, string> {
  const workers = runtime === 'workers'
  const denoCommand = 'deno run --no-prompt --no-lock --node-modules-dir=manual --allow-net=127.0.0.1 --allow-env=HOST,PORT,GREETING,LOG_LEVEL'
  const start = workers ? 'node serve.mjs' : runtime === 'node' ? 'node dist/index.js' : runtime === 'bun' ? 'bun dist/index.js' : `${denoCommand} dist/index.js`
  const dev = workers ? 'pnpm build && node serve.mjs --watch' : runtime === 'node' ? 'tsx watch src/index.ts' : runtime === 'bun' ? 'bun --watch src/index.ts' : `${denoCommand} --watch src/index.ts`
  const devDependencies: Record<string, string> = {
    '@types/node': '^22.13.10', esbuild: '^0.28.2', tsx: '^4.20.0', typescript: '^5.8.2',
    ...(runtime === 'bun' ? { '@types/bun': '1.4.4', 'bun-runtime': 'npm:bun@1.4.4' } : {}),
    ...(runtime === 'deno' ? { '@types/deno': '^2.7.0', 'deno-runtime': 'npm:deno@2.9.6' } : {}),
    ...(workers ? { miniflare: '3.20250718.3' } : {}),
  }
  const permissions = ['esbuild', ...(workers ? ['workerd'] : runtime === 'bun' ? ['bun'] : runtime === 'deno' ? ['deno'] : [])]
  const files: Record<string, string> = {
    'package.json': `${JSON.stringify({
      name, version: '0.0.0', private: true, type: 'module', packageManager: 'pnpm@12.6.0', engines: { node: '>=20.19.0' },
      longhorn: { schemaVersion: 1, runtime, framework: 'snapshot' },
      scripts: { dev, build: 'node build.mjs', start, typecheck: 'tsc --noEmit', test: 'tsx --test src/app.test.ts' },
      dependencies: { ...dependencies, zod: '^4.6.7' }, devDependencies,
    }, null, 2)}\n`,
    'pnpm-workspace.yaml': `# Keep all unpublished framework dependencies inside this project.\noverrides:\n${Object.entries(locations).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join('\n')}\n\nallowBuilds:\n${permissions.map((key) => `  ${key}: true`).join('\n')}\n${runtime === 'bun' ? "\nminimumReleaseAgeExclude:\n  - '@types/bun@1.4.4'\n" : ''}`,
    'tsconfig.json': `${JSON.stringify({ compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022', 'DOM'],
      types: ['node', ...(runtime === 'bun' ? ['bun'] : runtime === 'deno' ? ['deno'] : [])],
      strict: true, skipLibCheck: true, noEmit: true, verbatimModuleSyntax: true,
      noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true,
    }, include: ['src/**/*.ts'] }, null, 2)}\n`,
    'build.config.mjs': `export const buildOptions = {\n  entryPoints: ['src/index.ts'], outdir: 'dist', bundle: true, format: 'esm',\n  platform: '${workers ? 'browser' : runtime === 'node' ? 'node' : 'neutral'}', target: 'es2022', sourcemap: true,\n${workers ? '' : "  packages: 'external',\n"}}\n`,
    'build.mjs': "import { build } from 'esbuild'\nimport { rm } from 'node:fs/promises'\nimport { buildOptions } from './build.config.mjs'\n\nawait rm('dist', { recursive: true, force: true })\nawait build(buildOptions)\n",
    '.gitignore': 'node_modules/\ndist/\n.env\n.env.*\n!.env.example\n*.tsbuildinfo\n',
    'src/app.ts': app,
    'src/diagnostics.ts': diagnostics,
    'src/index.ts': workers ? workerEntry : nativeEntry(runtime),
    'src/app.test.ts': appTest,
    'README.md': readme(name, runtime),
    'docs/features.md': `# Feature connections\n\nThe host creates an application; HTTP handlers use the application container.\n\n| Feature | Guide | Owner | Connects to |\n| --- | --- | --- | --- |\n| HTTP | [HTTP](http.md) | @longhornjs/core and Hono | Runtime, DI, validation, request logs |\n| DI | [Dependency injection](dependency-injection.md) | @longhornjs/container | Application state, lifecycle, route handlers |\n| Lifecycle | [Lifecycle](lifecycle.md) | @longhornjs/core | Startup state, host shutdown |\n| Logging | [Logging](logging.md) | @longhornjs/logger | Host records, request IDs, HTTP errors |\n| Validation | [Validation](validation.md) | @longhornjs/validation | Zod Standard Schema, /echo |\n| Events | [Events](events.md) | @longhornjs/events | Typed echo event, DI, scoped listeners, lifecycle, /events |\n| Cache | [Cache](cache.md) | @longhornjs/cache | Typed public profile, TTL, shared loads, invalidation, lifecycle |\n| Readiness | [Readiness](readiness.md) | @longhornjs/observability | Explicit application check, /livez, /readyz, lifecycle |\n| Metrics | [Metrics](metrics.md) | @longhornjs/observability | Bounded HTTP counters/gauges/histograms, /metrics |\n| Tracing | [Tracing](tracing.md) | @longhornjs/observability | Explicit context, bounded memory exporter, /traces, safe route templates |\n| Runtime | [Runtime](runtime.md) | @longhornjs/${runtime} | Host entrypoint and Fetch |\n${workers ? '' : '| Configuration | [Configuration](configuration.md) | @longhornjs/config | Environment, schema, native listener |\n'}`,
    'docs/http.md': '# HTTP\n\n`src/app.ts` owns routes on the real Hono application at `app.http`.\n`GET /health` reads ready state from DI; `GET /` returns the greeting; `POST /echo`\nvalidates and trims JSON. Missing routes return JSON 404. Request IDs and child\nloggers come from core middleware. `pnpm test` exercises Fetch without a socket.\n',
    'docs/dependency-injection.md': '# Dependency injection\n\n`State` is an application-owned typed token in `src/app.ts`. Its provider resolves\none shared state object. Handlers use `c.get("container").resolve(State)`.\nThe startup hook initializes that object; its cleanup resets readiness.\nCreate a new application for an independent container and lifecycle.\n',
    'docs/lifecycle.md': `# Lifecycle\n\nCore runs startup before accepting Fetch dispatch or binding a native listener.\nHooks may return cleanup; core drains handlers/listeners before cleanup runs.\n${workers ? 'Workers owns isolate lifetime. Keep the module-scoped app between requests; do not call app.close() per request. Use c.executionCtx.waitUntil() for platform-owned background work. The local serve.mjs host disposes workerd on signals.' : 'The native entrypoint owns SIGINT/SIGTERM and awaits app.close(). Repeated shutdown signals are ignored during cleanup. A closed application is single-use; create another to restart.'}\n`,
    'docs/logging.md': '# Logging\n\nThe host supplies a structured JSON logger to core. Request logs include status,\nduration, and request ID; unexpected errors use the same correlation ID. Bodies,\nheaders, and query values are not logged by request middleware. Use\n`c.get("logger")` inside routes. The X-Request-Id response header connects a response\nto its logs. Tests use the default silent logger.\n',
    'docs/validation.md': '# Validation\n\n`validate("json", schema)` uses Standard Schema through Hono. Zod is an application\ndependency. `/echo` accepts a trimmed message of 1–200 characters and reads typed\noutput through `c.req.valid("json")`. Schema failures return 400 with normalized\nissues. Non-HTTP data can use parse/safeParse from @longhornjs/validation.\n',
    'docs/events.md': '# Application events\n\nThe typed app.echoed definition is a symbol identity from @longhornjs/events. The\napplication owns one EventBus through DI. Startup registers a scoped async observer;\nPOST /echo awaits dispatch before returning. GET /events reports this process/isolate\necho count and the last request ID. Message bodies are not kept by the observer.\n\nListeners run in registration order within one emission; independent emissions may\noverlap. emit rejects with EventDispatchError after attempting later listeners when\na listener fails. Subscriptions return an unsubscribe function, once reserves one\ndelivery, and scopes/AbortSignal control ownership. EventContext.emit supports\ncorrelated follow-ups while an accepted dispatch drains.\n\nThe lifecycle cleanup closes the bus before resetting readiness. Close stops new\nroot dispatches and waits for accepted work, then removes listeners. Scope close\nunsubscribes first and drains callbacks already running. Call these drain methods\nfrom outside the listeners they wait for. Return/await all listener work.\n\nEvents are in-process delivery, without persistence, retries, or cross-isolate\ntransport. Counts reset on restart. This starter publishes before its response and\nlets failures reach HTTP error handling; it has no committed database write to\nprotect. For durable post-commit delivery, choose a deliberate application error\npolicy and an appropriate outbox/queue design. pnpm test verifies awaited dispatch\nand request correlation through Fetch.\n',
    'docs/cache.md': '# Public profile cache\n\nGET /cached uses Cache<Profile> over a MemoryCacheStore, owned through DI. A cached\npublic runtime profile retains its generatedAt timestamp for five seconds. It never\ncontains request bindings, account identity, credentials, or echo bodies. The root\ngreeting and private data are not cached by this starter. POST /cached/invalidate\ndeletes this instance key; the next read loads a fresh profile. HTTP no-store keeps\nbrowser/proxy caches from obscuring the application-cache behavior.\n\nCache values have one declared type per instance. get returns a hit/miss union, so\na cached undefined is different from a miss. getOrLoad shares concurrent work for\none key. delete, clear, and explicit set fence older loads from repopulating it;\nalready waiting callers can still receive their earlier source result. Provider\nerrors reject as CacheStoreError, while loader errors propagate without caching.\n\nThe default copy policy uses structuredClone on input/output. Cache plain data;\nprovide a suitable custom copy if your value type needs other semantics. The raw\nstore is exclusively owned by its Cache; use the manager for reads and mutations.\n\nLifecycle cleanup drains events, then accepted cache work, then resets readiness.\nDo not await cache.close or recursively load the same key from its own loader.\nMemory entries and load sharing are process/isolate-local, without distributed\ninvalidation or persistence. Counts/data reset on restart.\n',
    "docs/readiness.md": "# Readiness and liveness\n\nThe diagnostics provider in src/diagnostics.ts owns Readiness, MetricRegistry and\nTracer through DI. /livez describes application liveness; /readyz awaits the explicit\napplication-state check, returning 200 or 503 with no-store. Add real dependency\nchecks before start when adding storage or external resources. Checks share active\nwork, have bounded response deadlines, and keep a busy slot until underlying work\nsettles. Close drains underlying work, so checks should honor their AbortSignal.\nReadiness cleanup runs before state reset; final telemetry closes onStop.\n",
    "docs/metrics.md": "# Request metrics\n\nhttpTelemetry records fixed method/status labels and registered route templates.\nUnknown URLs share _unmatched; IDs, bodies, query values and headers are omitted.\n/metrics serves counters, active handlers and cumulative latency histograms in\nPrometheus 0.0.4 text. Definitions and time series are bounded. Recording failures\ndo not replace business responses. /metrics and /traces exclude themselves. These\nare per-process/isolate values, reset on restart, with no remote metrics backend.\n",
    "docs/tracing.md": "# Request tracing\n\nThe explicit-context Tracer accepts validated traceparent headers and returns\na current traceparent. Request logs include trace/span IDs. Names use registered\nroute templates, and default attributes omit payloads, raw URLs and errors. Use\nrequestSpan(context) and tracer.startSpan(name,{parent:span.context}) for children.\nNo implicit global async context or automatic outbound request instrumentation is\ninstalled. /traces shows a bounded local memory buffer; it is a demo diagnostic\nendpoint, not an OTLP collector. Export is serial/best-effort, bounded under load,\nand isolated from requests. Native shutdown flushes accepted recording spans;\nWorkers isolate disposal is platform-owned, so final export is not guaranteed.\n",
    'docs/runtime.md': runtimeGuide(runtime),
    '.longhorn/README.md': '# Framework snapshot\n\nThese built packages were copied from the generator distribution. They are real\npackage exports and declarations, not source links to the original monorepo.\nThe root pnpm-workspace.yaml overrides every @longhornjs dependency to these local\nfolders, including transitive dependencies. Keep this directory in version control.\nThird-party packages still install through pnpm. To adopt a newer framework build,\nregenerate a separate project and review the snapshot changes. No automatic updater\nor published package release is implied.\n',
  }
  files['docs/features.md'] = files['docs/features.md']! + '| Managed application work | [Application work](application-work.md) | @longhornjs/core | app.run startup and non-HTTP drain |\n'
  files['docs/application-work.md'] = '# Managed application work\n\napp.run(callback) starts the shared lifecycle and keeps resources alive until the\nactual callback settles. Await/return child work. close stops root admission, drains\nHTTP and managed work, then releases resources. Do not await close from work it is\nwaiting for. Platform waitUntil extensions not awaited by the callback are separately\nowned by the platform. This API does not add persistence, retries or a global context.\n'
  if (workers) {
    files['serve.mjs'] = workerHost
    files['docs/features.md'] += '| Scheduled events | [Worker scheduled events](worker-scheduled.md) | @longhornjs/workers/scheduled | Platform controller, app.run, waitUntil, tracing |\n'
    files['docs/worker-scheduled.md'] = '# Worker scheduled events\n\nThe default export adds scheduled(controller,env,ctx) through createScheduledWorker.\nIt shares application startup with Fetch, passes each event context unchanged, and\nregisters/returns one completion Promise. The sample updates an isolate-local counter\nat GET /scheduled and exports a consumer span before completing. There is no durable\nschedule/queue state and no automatic deployment/cron configuration.\n\nLocal pinned Miniflare exposes /cdn-cgi/mf/scheduled?cron=*+*+*+*+*&time=123000 for\nmanual workerd dispatch. A deployed Worker needs application-owned Cron Triggers.\nDefault admission is one event per isolate, with a cooperative 30000-ms budget.\nSignal abort does not forcibly stop JavaScript; the invocation retains its slot and\nresources until the callback settles. Failures propagate to the platform; noRetry\nis forwarded and never called automatically. Keep effects idempotent for replay.\nDo not close a shared app per event. Native/remote storage and platform-final flush\nguarantees are separate integration choices.\n'
  }
  else {
    files['src/config.ts'] = config
    files['.env.example'] = 'HOST=127.0.0.1\nPORT=3000\nGREETING=Hello from LongHorn\nLOG_LEVEL=info\n'
    files['docs/configuration.md'] = `# Configuration\n\nThe host supplies environment records to loadConfig; src/config.ts validates and\ntransforms HOST, PORT, GREETING, and LOG_LEVEL. Defaults use loopback:3000 and info\nlogging; PORT=0 asks for an available port. Invalid configuration fails before\nlistening. ${runtime === 'node' ? 'Node reads optional .env then .env.local from the project working directory; process values win. The reader does not mutate process.env.' : runtime === 'bun' ? 'Bun supplies Bun.env and owns its native environment-file behavior.' : 'Deno.env reads only the permitted keys. The commands grant loopback networking; adjust --allow-net if HOST changes. No .env files are loaded by this host.'}\n`
  }
  return files
}

function readme(name: string, runtime: ProjectRuntime): string {
  return `# ${name}\n\nLongHorn starter for **${runtime}**. Requires Node.js 20.19+ and pnpm 12.6.0 for\ndevelopment tooling. ${runtime === 'bun' || runtime === 'deno' ? `A pinned local ${runtime} executable is installed as a development dependency.` : ''}\n\n\`\`\`sh\npnpm install\npnpm typecheck\npnpm test\npnpm build\npnpm start\n\`\`\`\n\nUse \`pnpm dev\` during development. The default address is http://127.0.0.1:3000.\nUse PORT=0 for an available port; the host prints its URL. Ctrl+C requests cleanup.\n\n\`\`\`sh\ncurl http://127.0.0.1:3000/health\ncurl http://127.0.0.1:3000/echo -H 'Content-Type: application/json' -d '{"message":"hello"}'\n\`\`\`\n\nSee [feature connections](docs/features.md), [runtime details](docs/runtime.md),\nand [the framework snapshot](.longhorn/README.md). Each implemented feature has a\nsmall guide. Framework packages are included locally because this development\nversion has not been published. Keep .longhorn/ and pnpm-workspace.yaml with the app.\n${runtime === 'workers' ? '\nThis is local workerd execution, not deployment. Production bindings and deployment configuration are application-owned.\n' : ''}`
}

function runtimeGuide(runtime: ProjectRuntime): string {
  const detail = runtime === 'workers'
    ? 'src/index.ts exports createScheduledWorker(app, options). Fetch receives platform bindings and execution context per request; scheduled events use the same lifecycle and await their consumer trace export. GREETING is a typed binding. See worker-scheduled.md for the local trigger and invocation limits. The browser build bundles dependencies and rejects Node builtins. In development, esbuild watches the source graph and reloads the Worker after successful builds; failed builds retain the last running module. serve.mjs uses pinned Miniflare 3.20250718.3/workerd compatibility date 2025-07-18 for Node 20.19+ tooling. It is local execution only; no Cloudflare credentials, production API coverage, or deployment is implied.'
    : `src/index.ts supplies ${runtime}Runtime to app.listen(). The adapter owns the native TCP server and returns its actual address and an async idempotent close(). Core owns startup, handler draining, and resource cleanup. ${runtime === 'deno' ? 'Deno 2.9.6 runs with explicit loopback network and HOST/PORT/GREETING/LOG_LEVEL environment permissions, without read, subprocess, or FFI permissions. The --watch dev command uses Deno watch mode.' : runtime === 'bun' ? 'Bun 1.4.4 owns the native listener. The --watch development command restarts the application after source changes.' : 'Node uses @hono/node-server. tsx watch owns development restarts; built execution uses plain Node.'}`
  return `# Runtime: ${runtime}\n\n${detail}\n\nThe starter has no database or durable state. Add a provider appropriate to this\nruntime behind an application service and acquire/close it through lifecycle hooks.\n`
}
