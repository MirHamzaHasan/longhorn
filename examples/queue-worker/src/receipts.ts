import type { DurableObjectState } from '@cloudflare/workers-types'
import { Longhorn } from '@longhornjs/core'
import { provide, token } from '@longhornjs/container'
import { migrate } from '@longhornjs/database'
import type { Database } from '@longhornjs/database'
import { createDurableSqlite } from '@longhornjs/workers/durable-sqlite'
import { validate } from '@longhornjs/validation/hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'

export const inputSchema = z.object({
  id: z.string().min(1).max(100).regex(/^[A-Za-z0-9._:-]+$/),
  numbers: z.array(z.number().finite().min(-1e12).max(1e12)).min(1).max(100),
}).strict()
const receiptSchema = z.object({
  id: inputSchema.shape.id, messageId: z.string().min(1).max(512),
  result: z.object({ count: z.number().int().min(1).max(100), sum: z.number().finite(), min: z.number().finite(), max: z.number().finite() }).strict(),
}).strict()
const ReceiptDatabase = token<Database>('queue receipt database')

export class ReceiptStore {
  private readonly app
  constructor(state: DurableObjectState) {
    const app = new Longhorn()
    app.onStart(async () => {
      const database = createDurableSqlite(state)
      try {
        await migrate(database, [{ id: 'queue_worker/001_receipts', statements: [
          'CREATE TABLE queue_receipts (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, result TEXT NOT NULL) STRICT',
        ] }])
        app.container.register(provide(ReceiptDatabase, { factory: () => database }))
        return () => database.close()
      } catch (error) { await database.close(); throw error }
    })
    app.http.use('*', bodyLimit({ maxSize: 16384, onError: c => c.json({ error: 'Request body too large' }, 413) }))
    app.http.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
    app.http.post('/store', validate('json', receiptSchema), async c => {
      const receipt = c.req.valid('json')
      await app.container.resolve(ReceiptDatabase).execute({ sql: 'INSERT INTO queue_receipts(id,message_id,result) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING',
        args: [receipt.id, receipt.messageId, JSON.stringify(receipt.result)] })
      return c.body(null, 204)
    })
    app.http.get('/receipts/:id', async c => {
      const row = (await app.container.resolve(ReceiptDatabase).execute({ sql: 'SELECT id,result FROM queue_receipts WHERE id = ?', args: [c.req.param('id')] })).rows[0]
      return row ? c.json({ receipt: { id: row.id, result: JSON.parse(String(row.result)) as unknown } }) : c.json({ error: 'Receipt not found' }, 404)
    })
    this.app = app
  }
  async fetch(request: Request): Promise<Response> { return await this.app.fetch(request) }
}
