import type { Longhorn } from '@longhorn/core'
import { provide, token } from '@longhorn/container'
import type { Database } from '@longhorn/database'
import type { JobHandler } from '@longhorn/queue'
import { MetricRegistry, Readiness, Tracer } from '@longhorn/observability'
import type { SpanContext, SpanExporter } from '@longhorn/observability'
import { httpTelemetry, livenessHandler, readinessHandler, requestSpan } from '@longhorn/observability/hono'
import { MemorySpanExporter } from '@longhorn/observability/memory'
import { OtlpHttpSpanExporter } from '@longhorn/observability/otlp'
import { PROMETHEUS_CONTENT_TYPE, renderPrometheus } from '@longhorn/observability/prometheus'
import type { AppConfig } from './config.js'

type WorkerStatus = { state: string; active: number; errors: number }
type RunnerStatus = { state: string; active: boolean; errors: number; dispatched: number }
export const JobsDiagnostics = token<ReturnType<typeof configureDiagnostics>>('jobs diagnostics')

export function configureDiagnostics(app: Longhorn, config: AppConfig, resources: {
  database: () => Database; worker: () => WorkerStatus; scheduler: () => RunnerStatus; exporter?: SpanExporter
}) {
  const meter = new MetricRegistry(), exporter = resources.exporter ?? (config.otlp ? new OtlpHttpSpanExporter(config.otlp) : new MemorySpanExporter({ capacity: 128 }))
  const tracer = new Tracer({ exporter, onError: () => app.logger.warn('Trace export failed', { component: 'tracing' }) })
  const readiness = new Readiness({ timeoutMs: 500 })
  readiness.add('database', async ({ signal }) => { if (signal.aborted) return false; await resources.database().execute('SELECT 1'); return true })
  if (config.workerEnabled) readiness.add('worker', () => resources.worker().state === 'running')
  if (config.schedulerEnabled) readiness.add('scheduler', () => resources.scheduler().state === 'running')
  const http = httpTelemetry({ meter, tracer, excludePaths: ['/metrics', '/traces', '/diagnostics'],
    onError: () => app.logger.warn('HTTP telemetry update failed', { component: 'http' }),
  })
  const failures = meter.counter({ name: 'longhorn_background_operation_errors_total', help: 'Background provider failures observed by this process.', labelNames: ['component'] })
  const active = meter.gauge({ name: 'longhorn_background_active', help: 'Active handler/tick calls in this process.', labelNames: ['component'] })
  const dispatched = meter.gauge({ name: 'longhorn_scheduler_dispatched', help: 'Occurrences dispatched by this process runner.' })
  const handlers = meter.counter({ name: 'longhorn_job_handlers_total', help: 'Report handler results before queue acknowledgement.', labelNames: ['outcome'] })
  const safe = (work: () => void) => { try { work() } catch { app.logger.warn('Background telemetry update failed', { component: 'background' }) } }
  app.http.use('*', http.middleware)
  app.http.use('*', async (c, next) => {
    const span = requestSpan(c)
    if (span) c.set('logger', c.get('logger').child({ traceId: span.context.traceId, spanId: span.context.spanId }))
    await next()
  })
  app.http.get('/livez', livenessHandler(() => app.state !== 'failed' && app.state !== 'stopped'))
  app.http.get('/readyz', readinessHandler(readiness))
  app.http.get('/metrics', (c) => {
    const worker = config.workerEnabled ? resources.worker() : undefined, scheduler = config.schedulerEnabled ? resources.scheduler() : undefined
    active.set(worker?.active ?? 0, { component: 'worker' }); active.set(scheduler?.active ? 1 : 0, { component: 'scheduler' })
    dispatched.set(scheduler?.dispatched ?? 0)
    c.header('Cache-Control', 'no-store'); c.header('Content-Type', PROMETHEUS_CONTENT_TYPE)
    return c.body(renderPrometheus(meter.snapshot()))
  })
  app.http.get('/traces', async (c) => {
    await tracer.flush(); c.header('Cache-Control', 'no-store')
    return c.json({ spans: exporter instanceof MemorySpanExporter ? exporter.snapshot() : [], stats: tracer.snapshot() })
  })
  app.http.get('/diagnostics', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json({ readiness: readiness.snapshot(), metrics: meter.stats(), traces: tracer.snapshot(), http: http.snapshot(),
      worker: config.workerEnabled ? resources.worker() : { state: 'disabled' }, scheduler: config.schedulerEnabled ? resources.scheduler() : { state: 'disabled' },
      ...(exporter instanceof OtlpHttpSpanExporter ? { otlp: exporter.stats() } : {}) })
  })
  app.onStop(async () => {
    const errors: unknown[] = []
    try { await readiness.close() } catch (error) { errors.push(error) }
    try { await tracer.close() } catch (error) { errors.push(error) } finally { meter.close() }
    if (errors.length) throw new AggregateError(errors, 'Observability cleanup failed')
  })
  const diagnostics = {
    meter, tracer, readiness,
    beginDrain: () => readiness.beginDrain(),
    backgroundError: (component: 'worker' | 'scheduler') => safe(() => failures.add(1, { component })),
    producer: <T>(work: () => Promise<T>, parent?: SpanContext) => tracer.trace('reports.enqueue', () => work(), { kind: 'producer', ...(parent ? { parent } : {}) }),
    handler: <T>(handler: JobHandler<T>): JobHandler<T> => (data, context) => tracer.trace('reports.process', async () => {
      try { await handler(data, context); safe(() => handlers.add(1, { outcome: 'returned' })) }
      catch (error) { safe(() => handlers.add(1, { outcome: 'threw' })); throw error }
    }, { kind: 'consumer', attributes: { 'queue.name': context.queue, 'job.attempt': context.attempt } }),
  }
  app.container.register(provide(JobsDiagnostics, { factory: () => diagnostics }))
  return diagnostics
}
