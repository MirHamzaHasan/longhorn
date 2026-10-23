import { Longhorn } from '../../packages/core/dist/index.js'
import { nodeRuntime } from '../../runtimes/node/dist/index.js'
import { createLogger } from '../../packages/logger/dist/index.js'
import { MetricRegistry, Readiness, Tracer } from '../../packages/observability/dist/index.js'
import { MemorySpanExporter } from '../../packages/observability/dist/memory.js'
import { httpTelemetry, readinessHandler, livenessHandler } from '../../packages/observability/dist/hono.js'
import { renderPrometheus } from '../../packages/observability/dist/prometheus.js'

const app = new Longhorn({ logger: createLogger({ level: 'silent' }) })
const readiness = new Readiness(), meter = new MetricRegistry(), exporter = new MemorySpanExporter(), tracer = new Tracer({ exporter })
let healthy = true
readiness.add('dependency', () => healthy)
app.http.use('*', httpTelemetry({ meter, tracer, excludePaths: ['/metrics', '/traces'] }).middleware)
app.http.get('/readyz', readinessHandler(readiness)); app.http.get('/livez', livenessHandler())
// Test-only controls live in this isolated fixture, never in the product app.
app.http.post('/fixture/unhealthy', (c) => { healthy = false; return c.body(null, 204) })
app.http.post('/fixture/healthy', (c) => { healthy = true; return c.body(null, 204) })
app.http.get('/items/:id', (c) => c.json({ ok: true }))
app.http.get('/failure', () => { throw new Error('Expected fixture failure') })
app.http.get('/metrics', (c) => c.text(renderPrometheus(meter.snapshot())))
app.http.get('/traces', async (c) => { await tracer.flush(); return c.json({ spans: exporter.snapshot() }) })
app.onStart(() => { readiness.start(); return () => readiness.close() })
app.onStop(async () => { try { await tracer.close() } finally { meter.close() }; console.log(JSON.stringify({ stopped: true, tracesClosed: exporter.stats().closed })) })
const server = await app.listen(nodeRuntime, { hostname: '127.0.0.1', port: 0 })
console.log(JSON.stringify({ url: server.url }))
let closing = false
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (closing) return
  closing = true; readiness.beginDrain(); console.log(JSON.stringify({ draining: true }))
  await new Promise((resolve) => setTimeout(resolve, 500))
  try { await app.close() } catch { process.exitCode = 1 }
})
