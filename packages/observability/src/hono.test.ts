import { expect, it } from 'vitest'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { MetricRegistry } from './metrics.js'
import type { Meter } from './metrics.js'
import { Tracer } from './tracing.js'
import { MemorySpanExporter } from './memory.js'
import { httpTelemetry, livenessHandler, readinessHandler, requestSpan } from './hono.js'
import { Readiness } from './readiness.js'
import { renderPrometheus } from './prometheus.js'

it('labels route templates/status/methods, propagates trace context and omits raw URLs/IDs/bodies/errors', async () => {
  const meter = new MetricRegistry(), exporter = new MemorySpanExporter(), tracer = new Tracer({ exporter })
  const instrumentation = httpTelemetry({ meter, tracer }), app = new Hono()
  app.onError((_, c) => c.json({ error: 'Internal Server Error' }, 500))
  app.use('*', instrumentation.middleware)
  app.post('/items/:id', async (c) => {
    await tracer.trace('items.write', () => 1, { parent: requestSpan(c)!.context })
    return c.json({ ok: true }, 201)
  })
  app.get('/failure/:id', () => { throw new Error('private failure detail') })
  const traceId = '4bf92f3577b34da6a3ce929d0e0e4736', parentId = '00f067aa0ba902b7'
  const response = await app.request('/items/private-id?token=query-secret', { method: 'POST', headers: {
    traceparent: `00-${traceId}-${parentId}-01`, Authorization: 'Bearer secret-header',
  }, body: 'secret-body' })
  expect(response.status).toBe(201); expect(response.headers.get('traceparent')).toMatch(new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`))
  await app.request('/failure/private-error-id')
  await app.request('/unknown-one'); await app.request('/unknown-two')
  await tracer.flush()
  const spans = exporter.snapshot(), server = spans.find((span) => span.kind === 'server' && span.name === 'POST /items/:id')!
  expect(server.parentSpanId).toBe(parentId)
  expect(spans.find((span) => span.name === 'items.write')?.parentSpanId).toBe(server.context.spanId)
  expect(spans.find((span) => span.name === 'GET /failure/:id')?.status).toBe('error')
  const data = renderPrometheus(meter.snapshot()) + JSON.stringify(spans)
  for (const secret of ['private-id', 'query-secret', 'secret-header', 'secret-body', 'private failure detail', 'private-error-id', 'unknown-one', 'unknown-two']) expect(data).not.toContain(secret)
  expect(data).toContain('route="/items/:id",status="201"')
  expect(data).toContain('route="_unmatched",status="404"} 2')
  expect(instrumentation.snapshot()).toEqual({ active: 0, errors: 0 })
  await tracer.close()
})
it('isolates runtime provider failures and never changes a success or handled client error', async () => {
  const broken: Meter = {
    counter: () => ({ add: () => { throw new Error('counter failed') } }),
    gauge: () => ({ set: () => { throw new Error('gauge failed') } }),
    histogram: () => ({ record: () => { throw new Error('histogram failed') } }),
  }
  const instrumentation = httpTelemetry({ meter: broken, tracer: { startSpan: () => { throw new Error('tracer failed') } }, onError: () => { throw new Error('observer failed') } })
  const app = new Hono(); app.use('*', instrumentation.middleware)
  app.get('/ok', (c) => c.text('ok'))
  app.get('/client-error', () => { throw new HTTPException(400, { message: 'Bad input' }) })
  expect((await app.request('/ok')).status).toBe(200)
  expect((await app.request('/client-error')).status).toBe(400)
  expect(instrumentation.snapshot().errors).toBeGreaterThan(0)
})
it('uses registered ALL-route templates while leaving wildcard-only misses bounded', async () => {
  const meter = new MetricRegistry(), app = new Hono()
  app.use('*', httpTelemetry({ meter }).middleware)
  app.use('/prefix/*', async (_, next) => next())
  app.all('/all/:id', (c) => c.text('all'))
  expect((await app.request('/all/private-id', { method: 'PUT' })).status).toBe(200)
  expect((await app.request('/prefix/private-miss')).status).toBe(404)
  const text = renderPrometheus(meter.snapshot())
  expect(text).toContain('method="PUT",route="/all/:id",status="200"')
  expect(text).toContain('route="_unmatched",status="404"')
  expect(text).not.toContain('private-id'); expect(text).not.toContain('private-miss')
})
it('excludes configured diagnostic paths and distinguishes readiness from liveness/draining', async () => {
  const readiness = new Readiness(), meter = new MetricRegistry(), app = new Hono()
  let healthy = false, live = true
  readiness.add('database', () => healthy); readiness.start()
  const telemetry = httpTelemetry({ meter, excludePaths: ['/metrics'] })
  app.use('*', telemetry.middleware)
  app.get('/readyz', readinessHandler(readiness)); app.get('/livez', livenessHandler(() => live))
  app.get('/metrics', (c) => c.text(renderPrometheus(meter.snapshot())))
  expect((await app.request('/livez')).status).toBe(200)
  const notReady = await app.request('/readyz')
  expect(notReady.status).toBe(503); expect(notReady.headers.get('Cache-Control')).toBe('no-store')
  healthy = true; expect((await app.request('/readyz')).status).toBe(200)
  readiness.beginDrain(); expect((await app.request('/readyz')).status).toBe(503)
  live = false; expect((await app.request('/livez')).status).toBe(503)
  await app.request('/metrics'); expect(renderPrometheus(meter.snapshot())).not.toContain('route="/metrics"')
  await readiness.close()
})
