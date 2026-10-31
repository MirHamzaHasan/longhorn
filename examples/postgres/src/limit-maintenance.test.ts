import { expect, it } from 'vitest'
import type { Database, QueryResult, SqlStatement } from '@longhornjs/database'
import { runLimitMaintenance } from './limit-maintenance.js'
import { grantLimitMaintenance } from './limit-maintenance-grants.js'
const config = { databaseUrl: 'private', limit: 2, intervalMs: 1000, statementTimeoutMs: 30000 }
const result = (rows: QueryResult['rows'] = [], rowsAffected = 0): QueryResult => ({ rows, rowsAffected, lastInsertId: undefined })
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve() }
function fixture(prune: (statement: SqlStatement) => Promise<QueryResult> = async () => result([], 2)) {
  const events: string[] = []
  const database: Database = { dialect: 'postgres', async execute(statement) {
    const sql = typeof statement === 'string' ? statement : statement.sql
    if (sql.startsWith('WITH principal')) { events.push('check'); return result([{ allowed: true, restricted: true, shape: true }]) }
    events.push('prune'); return prune(statement)
  }, async transaction(work) { return work(database) }, async close() { events.push('closed') } }
  return { database, events, loadConfiguration: async () => config, openDatabase: async () => { events.push('open'); return database } }
}
it('checks without pruning and runs exactly one bounded batch by default', async () => {
  for (const mode of ['check', 'once'] as const) {
    const owned = fixture(async statement => { expect(typeof statement !== 'string' && statement.args?.[1]).toBe(2); return result([], 2) })
    const report = await runLimitMaintenance({ ...owned, mode })
    expect(report).toMatchObject({ ok: true, runs: mode === 'once' ? 1 : 0, removed: mode === 'once' ? 2 : 0 })
    expect(owned.events).toEqual(mode === 'once' ? ['open', 'check', 'prune', 'closed'] : ['open', 'check', 'closed'])
    expect(JSON.stringify(report)).not.toContain('private')
  }
})
it('does not acquire on early cancellation and drains a committed one-shot after interruption', async () => {
  const controller = new AbortController(), early = fixture(); controller.abort()
  expect((await runLimitMaintenance({ ...early, mode: 'once', signal: controller.signal })).cancelled).toBe(true); expect(early.events).toEqual([])
  let release!: () => void; const late = new AbortController(), owned = fixture(async () => { await new Promise<void>(done => { release = done }); return result([], 2) })
  let done = false; const pending = runLimitMaintenance({ ...owned, mode: 'once', signal: late.signal }).then(report => { done = true; return report })
  await flush(); late.abort(); await flush(); expect(done).toBe(false); expect(owned.events).not.toContain('closed'); release()
  expect(await pending).toMatchObject({ ok: false, cancelled: true, runs: 1, removed: 2 }); expect(owned.events.at(-1)).toBe('closed')
})
it('drains watch error observation before database release and returns private failure', async () => {
  const controller = new AbortController(); let release!: () => void
  const owned = fixture(async () => { throw new Error('private provider detail') })
  const pending = runLimitMaintenance({ ...owned, mode: 'watch', signal: controller.signal, onError: async () => { await new Promise<void>(done => { release = done }); throw new Error('private observer detail') } })
  await flush(); controller.abort(); await flush(); expect(owned.events).not.toContain('closed'); release()
  const report = await pending; expect(report).toMatchObject({ ok: false, cancelled: true, errors: 1, observerErrors: 1 }); expect(owned.events.at(-1)).toBe('closed'); expect(JSON.stringify(report)).not.toContain('private')
})
it('rejects failed access and release without returning provider data', async () => {
  const owned = fixture(); owned.database.execute = async () => result([{ allowed: true, restricted: false, shape: true }])
  expect(await runLimitMaintenance({ ...owned, mode: 'once' })).toMatchObject({ ok: false, runs: 0, removed: 0 }); expect(owned.events).toEqual(['open', 'closed'])
  const broken = fixture(); broken.database.close = async () => { throw new Error('private close failure') }
  const report = await runLimitMaintenance({ ...broken, mode: 'check' }); expect(report.ok).toBe(false); expect(JSON.stringify(report)).not.toContain('private')
})
it('validates provisioning role names before opening a transaction', async () => {
  const owned = fixture(); owned.database.transaction = async () => { throw new Error('transaction must not start') }
  for (const name of ['pg_admin', 'Uppercase', 'bad;role', 'a'.repeat(64)]) await expect(grantLimitMaintenance(owned.database, name)).rejects.toThrow('Invalid maintenance role')
})

it('rejects unsupported programmatic modes before loading or echoing input', async () => {
  const owned = fixture(), privateMode = 'private-invalid-input'
  for (const mode of [privateMode, 'watch']) {
    let loaded = false
    await expect(runLimitMaintenance({ ...owned, mode: mode as never, loadConfiguration: async () => { loaded = true; return config } })).rejects.toThrow('Invalid maintenance mode or missing stop signal')
    expect(loaded).toBe(false); expect(owned.events).toEqual([])
  }
})
