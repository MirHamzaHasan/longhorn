import type { DurableObjectId } from '@cloudflare/workers-types'
import { Longhorn } from '@longhornjs/core'
import { provide, token } from '@longhornjs/container'
import { Tracer } from '@longhornjs/observability'
import { MemorySpanExporter } from '@longhornjs/observability/memory'
import { safeParse } from '@longhornjs/validation'
import { validate } from '@longhornjs/validation/hono'
import { createQueueWorker } from '@longhornjs/workers/queue'
import { bodyLimit } from 'hono/body-limit'
import { inputSchema } from './receipts.js'
export { ReceiptStore } from './receipts.js'

type Bindings = {
  MESSAGES: { send(body: unknown, options: { contentType: 'json' }): Promise<unknown> }
  RECEIPTS: { idFromName(name: string): DurableObjectId; get(id: DurableObjectId): { fetch(request: Request | string, init?: RequestInit): Promise<Response> } }
}
const app = new Longhorn<Bindings>(), exporter = new MemorySpanExporter(), tracer = new Tracer({ exporter })
const Diagnostics = token<Tracer>('queue consumer tracing')
app.container.register(provide(Diagnostics, { factory: () => tracer }))
app.onStop(() => tracer.close())
const store = (bindings: Bindings) => bindings.RECEIPTS.get(bindings.RECEIPTS.idFromName('receipts'))
let invalid = 0
const worker = createQueueWorker(app, { messageConcurrency: 4, maxConcurrentBatches: 1, timeoutMs: 20000,
  handle: async ({ message, bindings, signal }) => app.container.resolve(Diagnostics).trace('queue.process', async () => {
    signal.throwIfAborted()
    const parsed = await safeParse(inputSchema, message.body)
    // This example deliberately drops malformed input. Configure a different policy when required.
    if (!parsed.success) { invalid++; return { action: 'ack' } }
    const { id, numbers } = parsed.data
    const result = { count: numbers.length, sum: numbers.reduce((sum, value) => sum+value, 0), min: Math.min(...numbers), max: Math.max(...numbers) }
    const response = await store(bindings).fetch('http://receipts/store', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, messageId: message.id, result }) })
    if (!response.ok) throw new Error('Queue receipt storage failed')
    await response.text(); signal.throwIfAborted()
    return { action: 'ack' }
  }, { kind: 'consumer', attributes: { 'messaging.operation': 'process' } }),
  afterBatch: async () => { await tracer.flush() },
})
app.http.use('*', bodyLimit({ maxSize: 16384, onError: c => c.json({ error: 'Request body too large' }, 413) }))
app.http.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
app.http.get('/', c => c.json({ framework: 'LongHorn', endpoints: ['/messages','/receipts/:id','/queue','/traces'] }))
app.http.post('/messages', validate('json', inputSchema), async c => {
  const input = c.req.valid('json'); await c.env.MESSAGES.send(input, { contentType: 'json' })
  c.header('Location', '/receipts/'+input.id); return c.json({ id: input.id, status: 'accepted' }, 202)
})
app.http.get('/receipts/:id', c => store(c.env).fetch(c.req.raw))
app.http.get('/queue', c => c.json({ consumer: worker.stats(), invalid, effects: 'receipt Object SQLite', queue: 'platform broker' }))
app.http.get('/traces', async c => { await tracer.flush(); return c.json({ spans: exporter.snapshot(), stats: tracer.snapshot() }) })
export default worker
