import type { DurableObjectState } from '@cloudflare/workers-types'
import { Longhorn } from '@longhornjs/core'
import { migrate } from '@longhornjs/database'
import { createDurableSqlite } from '@longhornjs/workers/durable-sqlite'
import { validate } from '@longhornjs/validation/hono'
import { bodyLimit } from 'hono/body-limit'
import { receipt } from './contracts.js'
export class ReceiptStore {
  private readonly app: Longhorn
  constructor(state: DurableObjectState) {
    const app = this.app = new Longhorn(), database = createDurableSqlite(state)
    app.onStart(async () => { try { await migrate(database, [{ id: 'outbox_receipts/001', statements: [
      'CREATE TABLE receipts(message_id TEXT PRIMARY KEY,command_id TEXT NOT NULL,result TEXT NOT NULL) STRICT',
      'CREATE INDEX receipts_command ON receipts(command_id,message_id)',
    ] }]) } catch (error) { await database.close(); throw error }; return () => database.close() })
    app.http.use('*', bodyLimit({ maxSize: 16384, onError: c => c.json({ error: 'Request body too large' }, 413) }))
    app.http.post('/store', validate('json', receipt), async c => {
      const input = c.req.valid('json')
      const serialized=JSON.stringify(input.result)
      const accepted=await database.transaction(async tx=>{
        const inserted=await tx.execute({sql:'INSERT INTO receipts(message_id,command_id,result) VALUES(?,?,?) ON CONFLICT(message_id) DO NOTHING RETURNING message_id',args:[input.messageId,input.commandId,serialized]})
        if(inserted.rows.length)return true
        const prior=(await tx.execute({sql:'SELECT command_id,result FROM receipts WHERE message_id=?',args:[input.messageId]})).rows[0]
        return prior?.command_id===input.commandId && prior.result===serialized
      })
      return accepted?c.body(null,204):c.json({error:'Message ID already has a different effect'},409)
    })
    app.http.get('/health',async c=>{await database.execute('SELECT message_id FROM receipts LIMIT 0');return c.json({ready:true})})
    app.http.get('/receipts/:id', async c => {
      const rows = (await database.execute({ sql: 'SELECT message_id,result FROM receipts WHERE command_id=? ORDER BY message_id LIMIT 101', args: [c.req.param('id')] })).rows
      if(rows.length>100)return c.json({error:'Too many receipts for this command'},413)
      return rows.length ? c.json({ receipts: rows.map(row => ({ messageId: row.message_id, result: JSON.parse(String(row.result)) as unknown })) }) : c.json({ error: 'Receipt not found' }, 404)
    })
  }
  async fetch(request: Request): Promise<Response> { return await this.app.fetch(request) }
}
