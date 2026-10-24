import { createDurableSqlite } from '../../runtimes/workers/dist/durable-sqlite.js'
import { migrate } from '../../packages/database/dist/index.js'
import { authMigrations, SqliteAuthStore } from '../../packages/auth/dist/sqlite.js'
import { SqliteSessionInventoryStore, sqliteSessionInventoryMigrations } from '../../packages/auth/dist/sqlite-session-inventory.js'
import { SessionInventory } from '../../packages/auth/dist/session-inventory.js'
const raw = 'a'.repeat(64), other = 'b'.repeat(64), digest = async token => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), byte => byte.toString(16).padStart(2, '0')).join('')
export class InventoryFixture {
  constructor(state, env) { this.database = createDurableSqlite(state); this.env = env; this.time = 100; this.ready = undefined }
  initialize() { return this.ready ??= (async () => {
    await migrate(this.database, [...authMigrations, ...sqliteSessionInventoryMigrations]); const store = new SqliteAuthStore(this.database)
    await store.createUser({ id: 'object-inventory-owner', username: 'object.inventory', roles: [], passwordHash: 'unused-owned-fixture' })
    for (const token of [raw, other]) await store.createSession({ tokenHash: await digest(token), userId: 'object-inventory-owner', expiresAt: 10000 })
    this.reference = (await this.database.execute({ sql: 'SELECT session_id FROM longhorn_auth_sessions WHERE token_hash=?', args: [await digest(other)] })).rows[0].session_id
    this.inventory = new SessionInventory(new SqliteSessionInventoryStore(this.database), { clock: () => this.time })
  })() }
  async fetch(request) {
    await this.initialize(); const path = new URL(request.url).pathname
    if (path === '/hold') { await this.database.transaction(async tx => { await tx.execute('UPDATE longhorn_auth_sessions SET expires_at=expires_at'); this.time = Number(await (await fetch(this.env.GATE_URL)).text()) }); return Response.json({ released: true }) }
    if (path === '/rollback') {
      const problem = new Error('owned object commit failure'), database = this.database
      const wrapped = { dialect: database.dialect, execute: database.execute.bind(database), close: database.close.bind(database), transaction: work => database.transaction(async tx => { await work(tx); throw problem }) }
      let original = false; try { await new SessionInventory(new SqliteSessionInventoryStore(wrapped), { clock: () => this.time }).revoke(raw, this.reference) } catch (error) { original = error === problem }
      if (!original || (await this.inventory.list(raw)).sessions.length !== 2) throw new Error('Native Object rollback failed')
      return Response.json({ rollback: true, originalError: true })
    }
    if (path === '/revoke') return Response.json(await this.inventory.revoke(raw, this.reference))
    try { return Response.json(await this.inventory.list(raw, { limit: 50 })) } catch (error) { if (error.code === 'INVALID_CREDENTIALS') return Response.json({ expired: true }, { status: 401 }); throw error }
  }
}
export default { fetch(request, env) { return env.INVENTORY.get(env.INVENTORY.idFromName('owned')).fetch(request) } }
