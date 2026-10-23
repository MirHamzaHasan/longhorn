import type { Longhorn } from '@longhorn/core'
import { provide, token } from '@longhorn/container'
import { MetricRegistry, Readiness, Tracer } from '@longhorn/observability'
import { MemorySpanExporter } from '@longhorn/observability/memory'
import { httpTelemetry, livenessHandler, readinessHandler, requestSpan } from '@longhorn/observability/hono'
import { PROMETHEUS_CONTENT_TYPE, renderPrometheus } from '@longhorn/observability/prometheus'

const Diagnostics = token<{ meter: MetricRegistry; readiness: Readiness; tracer: Tracer }>('portable diagnostics')
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
