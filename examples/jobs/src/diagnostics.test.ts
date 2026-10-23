import { afterEach, expect, it } from 'vitest'
import { openSqlite } from '@longhorn/node/sqlite'
import type { Database } from '@longhorn/database'
import { createLogger } from '@longhorn/logger'
import type { LogRecord } from '@longhorn/logger'
import type { Longhorn } from '@longhorn/core'
import type { SpanExporter } from '@longhorn/observability'
import { createJobsApp, ReportWorker } from './app.js'
import { JobsDiagnostics } from './diagnostics.js'
import { configSchema } from './config.js'
const applications: Longhorn[] = []
afterEach(async () => { for (const app of applications.splice(0)) await app.close() })
async function setup(exporter?: SpanExporter, enabled = false) {
  const connection = await openSqlite({ filename: ':memory:' }), records: LogRecord[] = []
  let healthy = true
  const database: Database = { transaction: (work) => connection.transaction(work), close: () => connection.close(), execute: (input) => {
    if (input === 'SELECT 1' && !healthy) return Promise.reject(new Error('private database credentials'))
    return connection.execute(input)
  } }
  const app = createJobsApp(configSchema.parse({ WORKER_ENABLED: String(enabled), SCHEDULER_ENABLED: 'false' }), {
    openDatabase: async () => database, logger: createLogger({ sink: (record) => records.push(record) }), ...(exporter ? { exporter } : {}),
  })
  applications.push(app)
  const request = (path: string, body?: unknown) => app.fetch(new Request(`http://localhost${path}`, {
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  }))
  return { app, request, records, setHealthy: (value: boolean) => { healthy = value } }
}
it('probes dependencies separately from liveness and exposes bounded request metrics/traces without input data', async () => {
  const { app, request, setHealthy, records } = await setup()
  expect((await request('/readyz')).status).toBe(200)
  setHealthy(false)
  const notReady = await request('/readyz')
  expect(notReady.status).toBe(503); expect((await request('/livez')).status).toBe(200)
  expect(JSON.stringify(await notReady.json())).not.toContain('private database credentials')
  setHealthy(true)
  const created = await request('/reports', { numbers: [1234567] })
  const { job } = await created.json()
  const metricText = await (await request(`/reports/${job.id}?private=secret-query`)).text()
  expect(metricText).toContain(job.id)
  const metrics = await (await request('/metrics')).text()
  expect(metrics).toContain('route="/reports/:id"'); expect(metrics).not.toContain(job.id)
  const traces = await (await request('/traces')).json()
  expect(traces.spans.some((span: { name: string }) => span.name === 'reports.enqueue')).toBe(true)
  for (const value of ['1234567', job.id, 'secret-query', 'private database credentials']) expect(JSON.stringify(traces)).not.toContain(value)
  expect(records.some((record) => record.message === 'HTTP request completed' && typeof record.fields.traceId === 'string')).toBe(true)
  const diagnostics = app.container.resolve(JobsDiagnostics)
  diagnostics.beginDrain(); expect((await request('/readyz')).status).toBe(503)
  expect((await request('/livez')).status).toBe(200)
})
it('marks an unexpectedly stopped enabled worker unready', async () => {
  const { app, request } = await setup(undefined, true)
  expect((await request('/readyz')).status).toBe(200)
  await app.container.resolve(ReportWorker).close()
  expect((await request('/readyz')).status).toBe(503)
})
it('keeps report work successful when every span export fails', async () => {
  const exporter: SpanExporter = { export: async () => { throw new Error('private exporter detail') }, close: async () => {} }
  const { app, request } = await setup(exporter, true)
  const response = await request('/reports', { numbers: [2, 4] }); expect(response.status).toBe(202)
  const { job } = await response.json(), deadline = Date.now() + 2000
  while (true) {
    const status = await (await request(`/reports/${job.id}`)).json()
    if (status.job.state === 'succeeded') { expect(status.report.sum).toBe(6); break }
    if (Date.now() > deadline) throw new Error('Worker did not finish')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  await app.container.resolve(JobsDiagnostics).tracer.flush()
  expect(app.container.resolve(JobsDiagnostics).tracer.snapshot().exportErrors).toBeGreaterThan(0)
})
it('drains an underlying readiness operation before database close, then closes tracing and metrics', async () => {
  const connection = await openSqlite({ filename: ':memory:' }), order: string[] = []
  let enter!: () => void, release!: () => void
  const entered = new Promise<void>((resolve) => { enter = resolve }), gate = new Promise<void>((resolve) => { release = resolve })
  const database: Database = { transaction: (work) => connection.transaction(work),
    close: async () => { await connection.close(); order.push('database') },
    execute: async (input) => { if (input === 'SELECT 1') { enter(); await gate }; return connection.execute(input) },
  }
  const app = createJobsApp(configSchema.parse({ WORKER_ENABLED: 'false', SCHEDULER_ENABLED: 'false' }), {
    openDatabase: async () => database,
    exporter: { export: async () => {}, close: async () => { order.push('tracing') } },
  })
  applications.push(app)
  const probe = app.fetch(new Request('http://localhost/readyz')); await entered
  const diagnostics = app.container.resolve(JobsDiagnostics)
  diagnostics.beginDrain(); expect((await probe).status).toBe(503)
  const closing = app.close(); await Promise.resolve(); expect(order).toEqual([])
  release(); await closing
  expect(order).toEqual(['database', 'tracing'])
  expect(diagnostics.meter.stats().closed).toBe(true)
  expect(diagnostics.readiness.snapshot().phase).toBe('closed')
})
