import type { DurableObjectId } from '@cloudflare/workers-types'
import { Longhorn } from '@longhornjs/core'
import { Tracer } from '@longhornjs/observability'
import { MemorySpanExporter } from '@longhornjs/observability/memory'
import { safeParse } from '@longhornjs/validation'
import { createQueueWorker } from '@longhornjs/workers/queue'
import { envelope } from './contracts.js'
import { numbersReceipt } from './message-effect.js'
export { CommandStore } from './commands.js'
export { ReceiptStore } from './receipts.js'
export { commandMigrations } from './migrations.js'
type Objects = { idFromName(name: string): DurableObjectId; get(id: DurableObjectId): { fetch(request: Request | string, init?: RequestInit): Promise<Response> } }
type Bindings = { COMMANDS: Objects; RECEIPTS: Objects }
const app = new Longhorn<Bindings>(), tracer = new Tracer({ exporter: new MemorySpanExporter() })
app.onStop(() => tracer.close())
const object = (bindings: Bindings, name: keyof Bindings) => bindings[name].get(bindings[name].idFromName(name.toLowerCase()))
for (const path of ['/health','/commands','/commands/:id','/deliveries/:id','/operations/deliveries','/operations/deliveries/:id','/operations/deliveries/:id/retry','/operations/audit']) app.http.all(path, c => object(c.env, 'COMMANDS').fetch(c.req.raw))
app.http.get('/receipts/:id', c => object(c.env, 'RECEIPTS').fetch(c.req.raw))
app.http.get('/', c => c.json({ framework: 'LongHorn', pipeline: 'SQL outbox -> broker -> SQL receipts', endpoints: ['/commands','/commands/:id','/deliveries/:id','/receipts/:id'] }))
export default createQueueWorker(app, { messageConcurrency: 4, maxConcurrentBatches: 1, timeoutMs: 20000,
  handle: async ({ message, bindings, signal }) => tracer.trace('outbox.consume', async () => {
    signal.throwIfAborted()
    const parsed = await safeParse(envelope, message.body)
    if (!parsed.success) return { action: 'ack' } // explicit malformed-message policy for this example
    const response = await object(bindings, 'RECEIPTS').fetch('http://receipts/store', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(numbersReceipt(parsed.data)) })
    if (!response.ok) throw new Error('Outbox receipt storage failed')
    await response.text(); signal.throwIfAborted(); return { action: 'ack' }
  }, { kind: 'consumer', attributes: { 'messaging.operation': 'process' } }),
  afterBatch: async () => { await tracer.flush() },
})
