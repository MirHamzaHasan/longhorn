import { Longhorn } from '@longhorn/core'
import { provide,token } from '@longhorn/container'
import { createLogger } from '@longhorn/logger'
import { Tracer } from '@longhorn/observability'
import { MemorySpanExporter } from '@longhorn/observability/memory'
import { Queue } from '@longhorn/queue'
import { Scheduler } from '@longhorn/scheduler'
import { MemorySchedulerStore } from '@longhorn/scheduler/memory'
import { createScheduledWorker } from '@longhorn/workers/scheduled'
import type { ScheduledInvocation } from '@longhorn/workers/scheduled'
import { z } from 'zod'

type AuditBinding={ put(key: string,value: string): Promise<void>;get(key: string): Promise<string | null> }
type Bindings={ AUDIT?: AuditBinding }
const data=z.object({ scheduledTime: z.number().int().nonnegative(),cron: z.string().max(512) }).strict()
const exporter=new MemorySpanExporter(),tracer=new Tracer({ exporter })
const Diagnostics=token<Tracer>('scheduled event tracing')
const app=new Longhorn<Bindings>({ logger: createLogger({ bindings: { app: 'scheduled-worker' } }) })
app.container.register(provide(Diagnostics,{ factory: () => tracer }))
app.onStop(() => tracer.close())

async function audit({ controller,bindings,signal }: ScheduledInvocation<Bindings>): Promise<void> {
  const target=bindings.AUDIT
  if (!target) { controller.noRetry();throw new Error('AUDIT binding is required') }
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([controller.cron,controller.scheduledTime])))
  const id='audit.'+[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('')
  // Invocation-local queue/cursor state is transient; KV effects use a stable event-derived key.
  const store=new MemorySchedulerStore(),queue=new Queue({ name: 'worker.audit.v1',store: store.queueStore,schema: data })
  const scheduler=new Scheduler({ store })
  try {
    signal.throwIfAborted()
    // Platform delivery already chose the execution time. Zero makes this stable one-shot immediately due.
    await scheduler.at(queue,{ scheduledTime: controller.scheduledTime,cron: controller.cron },{ id,at: 0,maxAttempts: 1 })
    const tick=await scheduler.tick({ limit: 1 })
    if (tick.dispatched.length!==1) throw new Error('Scheduled audit occurrence was not dispatched')
    const result=await queue.runOnce(async (input,job) => {
      signal.throwIfAborted();job.signal.throwIfAborted()
      const value=JSON.stringify({ ...input,jobId: job.id })
      await target.put('events/'+job.id,value)
      signal.throwIfAborted()
      await target.put('last-scheduled',value)
    })
    if (result.status!=='succeeded') throw new Error('Scheduled audit effect failed')
  } finally { try { await scheduler.close() } finally { await queue.close() } }
}

const worker=createScheduledWorker(app,{ maxConcurrent: 2,timeoutMs: 10000,handle: async invocation => {
  try { await app.container.resolve(Diagnostics).trace('scheduled.audit',() => audit(invocation),{ kind: 'consumer',attributes: { 'trigger.kind': 'cron' } }) }
  finally { await tracer.flush() }
} })
app.http.get('/',c => c.json({ framework: 'LongHorn',runtime: 'workers',endpoints: ['/health','/scheduled','/scheduled/last','/traces'] }))
app.http.get('/health',c => c.json({ status: 'ok' }))
app.http.get('/scheduled',c => { c.header('Cache-Control','no-store');return c.json({ invocations: worker.stats(),schedulingStorage: 'invocation-memory',effects: 'AUDIT KV binding' }) })
app.http.get('/scheduled/last',async c => {
  c.header('Cache-Control','no-store')
  if (!c.env.AUDIT) return c.json({ error: 'AUDIT binding is required' },503)
  const value=await c.env.AUDIT.get('last-scheduled')
  return value ? c.json({ audit: JSON.parse(value) as unknown }) : c.json({ error: 'No scheduled audit yet' },404)
})
app.http.get('/traces',async c => { await tracer.flush();c.header('Cache-Control','no-store');return c.json({ spans: exporter.snapshot(),stats: tracer.snapshot() }) })
export default worker
