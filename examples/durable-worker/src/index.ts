import type { DurableObjectId, DurableObjectState } from '@cloudflare/workers-types'
import { Longhorn } from '@longhornjs/core'
import { createScheduledWorker } from '@longhornjs/workers/scheduled'
import { createReportApp } from './app.js'
import { parseReportConfig } from './config.js'
import type { ReportLimitBindings } from './config.js'

// Use the Web Standard subset at the Fetch boundary; platform storage types stay in the Object.
type Bindings = ReportLimitBindings & { REPORTS: {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): { fetch(request: Request | string, init?: RequestInit): Promise<Response> }
} }
export class ReportCoordinator {
  private readonly app: Longhorn | undefined
  constructor(state: DurableObjectState, bindings: ReportLimitBindings = {}) {
    const config = parseReportConfig(bindings)
    this.app = config ? createReportApp(state, config) : undefined
  }
  async fetch(request: Request): Promise<Response> { return this.app ? await this.app.fetch(request) : Response.json({ error: 'Report configuration unavailable' }, { status: 503 }) }
}
const app = new Longhorn<Bindings>()
const coordinator = (bindings: Bindings) => bindings.REPORTS.get(bindings.REPORTS.idFromName('reports'))
for (const path of ['/health', '/reports', '/reports/:id', '/report-schedules', '/report-schedules/:id']) {
  app.http.all(path, c => coordinator(c.env).fetch(c.req.raw))
}
app.http.get('/', c => c.json({ framework: 'LongHorn', storage: 'durable-object-sqlite', endpoints: ['/health','/reports','/report-schedules'] }))
export default createScheduledWorker(app, { maxConcurrent: 1, timeoutMs: 20000, handle: async ({ bindings, signal }) => {
  signal.throwIfAborted()
  // Await the Object's response. A Worker abort cannot undo already-admitted Object work.
  const response = await coordinator(bindings).fetch('http://coordinator/_tick', { method: 'POST' })
  if (!response.ok) throw new Error('Durable report tick failed')
  await response.text()
  signal.throwIfAborted()
} })
