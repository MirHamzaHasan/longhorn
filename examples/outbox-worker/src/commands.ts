import type { DurableObjectState } from '@cloudflare/workers-types'
import { Longhorn } from '@longhorn/core'
import { provide, token } from '@longhorn/container'
import { migrate } from '@longhorn/database'
import type { Database } from '@longhorn/database'
import { Idempotency, IdempotencyConflictError } from '@longhorn/idempotency'
import { SqliteIdempotencyStore } from '@longhorn/idempotency/sqlite'
import { Outbox } from '@longhorn/outbox'
import { SqliteOutboxStore } from '@longhorn/outbox/sqlite'
import { createDurableSqlite } from '@longhorn/workers/durable-sqlite'
import { createQueuePublisher } from '@longhorn/workers/outbox'
import type { QueueProducerBinding } from '@longhorn/workers/outbox'
import { createSqliteAlarmClock } from '@longhorn/workers/sqlite-alarms'
import type { SqliteAlarmClock, WorkerAlarmInfo } from '@longhorn/workers/sqlite-alarms'
import { Tracer } from '@longhorn/observability'
import { MemorySpanExporter } from '@longhorn/observability/memory'
import { validate } from '@longhorn/validation/hono'
import { bodyLimit } from 'hono/body-limit'
import type { z } from 'zod'
import { commandInput, messageData, topic } from './contracts.js'
import { commandMigrations } from './migrations.js'
import { configureOperations } from './operations.js'

type Data = z.output<typeof messageData>
const CommandDatabase = token<Database>('outbox command database'), Messages = token<Outbox<Data>>('outgoing command messages'), Requests = token<Idempotency>('command request replay')
export class CommandStore {
  private readonly app: Longhorn
  private readonly clock: SqliteAlarmClock
  constructor(state: DurableObjectState, env: { MESSAGES: QueueProducerBinding; DISPATCH_ENABLED?: boolean; OUTBOX_OPERATIONS_TOKEN?: string; OUTBOX_OPERATIONS_ACTOR?: string }, options: { leaseMs?: number } = {}) {
    const app = this.app = new Longhorn(), database = createDurableSqlite(state)
    const tracer = new Tracer({ exporter: new MemorySpanExporter() })
    app.onStop(() => tracer.close())
    app.container.register(provide(CommandDatabase, { factory: () => database }))
    app.container.register(provide(Messages, { deps: [CommandDatabase], factory: db => new Outbox({ name: topic, schema: messageData,
      store: new SqliteOutboxStore(db), leaseMs: options.leaseMs ?? 1000, retryDelayMs: 100, maxRetryDelayMs: 1000 }) }))
    app.container.register(provide(Requests, { deps: [CommandDatabase], factory: db => new Idempotency({ store: new SqliteIdempotencyStore(db) }) }))
    const publisher = createQueuePublisher<Data>(env.MESSAGES)
    this.clock = createSqliteAlarmClock(state, { application: app, database, queues: [`outbox.${topic}`], batchSize: 10, minDelayMs: 25, timeoutMs: 20000,
      handle: async ({ signal, limit }) => {
        try {
          for (let i = 0; i < limit; i++) {
            signal.throwIfAborted()
            const result = await app.container.resolve(Messages).dispatchOnce({ publish: (message, context) =>
              tracer.trace('outbox.publish', () => publisher.publish(message, context), { kind: 'producer', attributes: { 'messaging.operation': 'publish' } }) })
            if (result.status === 'idle') break
          }
        } finally { await tracer.flush() }
      },
    })
    app.onStart(async () => {
      try { await migrate(database, commandMigrations) }
      catch (error) { await database.close(); throw error }
      return () => database.close()
    })
    app.onStart(() => { const messages = app.container.resolve(Messages); return () => messages.close() })
    app.onStart(async () => { if (env.DISPATCH_ENABLED !== false) await this.clock.start(); return () => this.clock.close() })
    app.http.use('*', bodyLimit({ maxSize: 16384, onError: c => c.json({ error: 'Request body too large' }, 413) }))
    app.http.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
    app.http.get('/health', c => c.json({ ok: true }))
    app.http.post('/commands', validate('json', commandInput), async c => {
      const input = c.req.valid('json')
      try {
        const result = await app.container.resolve(Requests).run({ scope: 'public:numbers-command:v1', key: input.id, input }, async tx => {
          const id = crypto.randomUUID()
          await tx.execute({ sql: 'INSERT INTO commands(id,numbers) VALUES(?,?)', args: [id, JSON.stringify(input.numbers)] })
          const delivery = await app.container.resolve(Messages).enqueueInTransaction(tx, { commandId: id, numbers: input.numbers })
          return { command: { id, numbers: input.numbers }, delivery }
        })
        c.header('Location', '/commands/'+result.value.command.id); c.header('Delivery-Location', '/deliveries/'+result.value.delivery.id)
        c.header('Receipt-Location', '/receipts/'+result.value.command.id); c.header('Idempotency-Replayed', String(result.replayed))
        return c.json(result.value, 201)
      } catch (error) { if (error instanceof IdempotencyConflictError) return c.json({ error: 'Command ID was already used with different input' }, 409); throw error }
    })
    app.http.get('/commands/:id', async c => {
      const row = (await database.execute({ sql: 'SELECT id,numbers FROM commands WHERE id=?', args: [c.req.param('id')] })).rows[0]
      return row ? c.json({ command: { id: row.id, numbers: JSON.parse(String(row.numbers)) as unknown } }) : c.json({ error: 'Command not found' }, 404)
    })
    app.http.get('/deliveries/:id', async c => { const delivery = await app.container.resolve(Messages).get(c.req.param('id')); return delivery ? c.json({ delivery }) : c.json({ error: 'Delivery not found' }, 404) })
    configureOperations(app, () => app.container.resolve(Messages), env.OUTBOX_OPERATIONS_TOKEN, env.OUTBOX_OPERATIONS_ACTOR)
  }
  async fetch(request: Request): Promise<Response> { return await this.app.fetch(request) }
  alarm(info?: WorkerAlarmInfo): Promise<void> { return this.clock.alarm(info) }
}
