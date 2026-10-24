import type { DurableObjectId, DurableObjectState } from '@cloudflare/workers-types'
import { Longhorn } from '@longhorn/core'
import { provide, token } from '@longhorn/container'
import { Tracer } from '@longhorn/observability'
import { MemorySpanExporter } from '@longhorn/observability/memory'
import { createWorker } from '@longhorn/workers'
import { alarmClockMigrations, createSqliteAlarmClock } from '@longhorn/workers/sqlite-alarms'
import type { WorkerAlarmInfo, SqliteAlarmClock } from '@longhorn/workers/sqlite-alarms'
import { createReportApp, ReportClock, runReportBatch } from './app.js'
import { migrations, reportQueueName } from './reports.js'
import { parseReportConfig } from './config.js'
import type { ReportLimitBindings } from './config.js'

type Bindings = ReportLimitBindings & { REPORTS: { idFromName(name: string): DurableObjectId; get(id: DurableObjectId): { fetch(request: Request): Promise<Response> } } }
const Diagnostics = token<Tracer>('alarm report tracing')
export class ReportAlarmCoordinator {
  private readonly app: Longhorn | undefined
  private readonly clock: SqliteAlarmClock | undefined
  constructor(state: DurableObjectState, bindings: ReportLimitBindings = {}) {
    const config = parseReportConfig(bindings)
    if (!config) { this.app = undefined; this.clock = undefined; return }
    const exporter = new MemorySpanExporter(), tracer = new Tracer({ exporter })
    const app = createReportApp(state, { ...config, migrations: [...migrations, ...alarmClockMigrations], clock: (application, database) => createSqliteAlarmClock(state, {
      database, application, queues: [reportQueueName], batchSize: 10, timeoutMs: 20000,
      handle: async ({ signal, limit }) => {
        try { await application.container.resolve(Diagnostics).trace('alarm.reports', () => runReportBatch(application, limit, signal), { kind: 'consumer', attributes: { 'trigger.kind': 'alarm' } }) }
        finally { await tracer.flush() }
      },
    }) })
    app.container.register(provide(Diagnostics, { factory: () => tracer }))
    app.onStop(() => tracer.close())
    app.http.get('/alarm-traces', async c => { await tracer.flush(); return c.json({ spans: exporter.snapshot(), stats: tracer.snapshot() }) })
    this.app = app; this.clock = app.container.resolve(ReportClock)
  }
  async fetch(request: Request): Promise<Response> { return this.app ? await this.app.fetch(request) : Response.json({ error: 'Report configuration unavailable' }, { status: 503 }) }
  alarm(info?: WorkerAlarmInfo): Promise<void> { return this.clock ? this.clock.alarm(info) : Promise.reject(new Error('Report configuration unavailable')) }
}
const app = new Longhorn<Bindings>()
for (const path of ['/health','/reports','/reports/:id','/report-schedules','/report-schedules/:id','/alarm','/alarm-traces']) {
  app.http.all(path, c => c.env.REPORTS.get(c.env.REPORTS.idFromName('reports')).fetch(c.req.raw))
}
app.http.get('/', c => c.json({ framework: 'LongHorn', wakeups: 'durable-object-alarm', endpoints: ['/health','/reports','/report-schedules','/alarm','/alarm-traces'] }))
export default createWorker(app)
