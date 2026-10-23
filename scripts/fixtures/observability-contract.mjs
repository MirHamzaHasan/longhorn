import { Hono } from '../../packages/http/dist/index.js'
import { MetricRegistry, Readiness, Tracer, TracerClosedError } from '../../packages/observability/dist/index.js'
import { MemorySpanExporter } from '../../packages/observability/dist/memory.js'
import { httpTelemetry, readinessHandler, livenessHandler, requestSpan } from '../../packages/observability/dist/hono.js'
import { renderPrometheus } from '../../packages/observability/dist/prometheus.js'

const check = (value, message) => { if (!value) throw new Error(message) }
export async function verifyObservability() {
  const readiness = new Readiness(), meter = new MetricRegistry(), exporter = new MemorySpanExporter({ capacity: 8 })
  const tracer = new Tracer({ exporter }), app = new Hono(), http = httpTelemetry({ meter, tracer })
  let healthy = false
  readiness.add('database', () => healthy); readiness.start()
  app.use('*', http.middleware)
  app.get('/readyz', readinessHandler(readiness)); app.get('/livez', livenessHandler())
  app.post('/items/:id', async (c) => {
    await tracer.trace('items.write', () => 1, { parent: requestSpan(c).context })
    return c.json({ ok: true }, 201)
  })
  check((await app.request('/readyz')).status === 503, 'Unhealthy dependency was ready')
  check((await app.request('/livez')).status === 200, 'Readiness incorrectly controls liveness')
  healthy = true; check((await app.request('/readyz')).status === 200, 'Health did not recover')
  const traceId = '4bf92f3577b34da6a3ce929d0e0e4736', parentId = '00f067aa0ba902b7'
  const response = await app.request('/items/private-item?token=private-query', { method: 'POST', body: 'private-body', headers: { traceparent: `00-${traceId}-${parentId}-01` } })
  check(response.status === 201 && response.headers.get('traceparent')?.startsWith(`00-${traceId}-`), 'Context propagation failed')
  await app.request('/unknown-private-one'); await app.request('/unknown-private-two')
  await tracer.flush()
  const text = renderPrometheus(meter.snapshot()), spans = exporter.snapshot()
  check(text.includes('route="/items/:id",status="201"'), 'Metric route template missing')
  check(text.includes('route="_unmatched",status="404"} 2'), 'Unknown URLs created separate series')
  const server = spans.find((span) => span.name === 'POST /items/:id'), child = spans.find((span) => span.name === 'items.write')
  check(server.parentSpanId === parentId && child.parentSpanId === server.context.spanId, 'Explicit trace hierarchy lost')
  const exposed = text + JSON.stringify(spans)
  for (const value of ['private-item', 'private-query', 'private-body', 'unknown-private-one', 'unknown-private-two']) check(!exposed.includes(value), 'Telemetry leaked request data')
  readiness.beginDrain(); check((await app.request('/readyz')).status === 503, 'Drain remained ready')
  await readiness.close()

  let release, entered
  const gate = new Promise((resolve) => { release = resolve }), started = new Promise((resolve) => { entered = resolve })
  const slow = new Readiness({ timeoutMs: 10 }); let calls = 0, signal
  slow.add('slow', async (context) => { calls++; signal = context.signal; entered(); await gate; return true }); slow.start()
  const probe = slow.check(); await started
  check((await probe).checks[0].status === 'timeout', 'Readiness deadline ignored')
  check((await slow.check()).checks[0].status === 'busy' && calls === 1 && signal.aborted, 'Stuck checks accumulated')
  const closed = slow.close(); release(); await closed

  const held = tracer.startSpan('accepted')
  const closing = tracer.close(); let stopped = false
  try { tracer.startSpan('late') } catch (error) { stopped = error instanceof TracerClosedError }
  check(stopped, 'Closed tracer admitted spans')
  held.end(); await closing
  check(exporter.stats().closed && http.snapshot().active === 0, 'Telemetry did not drain')
  const broken = new Tracer({ exporter: { export: async () => { throw new Error('private-exporter-error') }, close: async () => {} } })
  check(await broken.trace('business', () => 7) === 7, 'Exporter replaced business result')
  await broken.close(); check(broken.snapshot().exportErrors === 1, 'Exporter failure was not observable')
  return { verified: true, readiness: true, bounded: true, metrics: true, tracing: true, private: true, drained: true }
}
