import type { DurableObjectId, DurableObjectState } from '@cloudflare/workers-types'
import { Longhorn } from '@longhorn/core'
import { createScheduledWorker } from '@longhorn/workers/scheduled'
import { createReportApp } from './app.js'

// Use the Web Standard subset at the Fetch boundary; platform storage types stay in the Object.
type Bindings = { REPORTS: {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): { fetch(request: Request | string, init?: RequestInit): Promise<Response> }
} }
export class ReportCoordinator {
  private readonly app
  constructor(state: DurableObjectState) { this.app = createReportApp(state) }
  async fetch(request: Request): Promise<Response> { return await this.app.fetch(request) }
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
