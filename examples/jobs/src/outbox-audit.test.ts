import { afterEach, beforeEach, expect, it } from 'vitest'
import { migrate } from '@longhorn/database'
import type { Database } from '@longhorn/database'
import { openSqlite } from '@longhorn/node/sqlite'
import { Outbox } from '@longhorn/outbox'
import { SqliteOutboxStore, outboxMigrations, outboxRecoveryMigrations, outboxAuditMigrations } from '@longhorn/outbox/sqlite'
import { queueMigrations } from '@longhorn/queue/sqlite'
import { z } from 'zod'
let database: Database, outgoing: Outbox<{ secret: string }>
const schema = z.object({ secret: z.string() }), reject = { async publish() { throw new Error('owned publisher error') } }
const request = { actor: 'user:42', reason: 'provider-restored', expectedMaxAttempts: 1, additionalAttempts: 1 }
beforeEach(async () => {
  database = await openSqlite({ filename: ':memory:' })
  await migrate(database, [...queueMigrations, ...outboxMigrations, ...outboxRecoveryMigrations, ...outboxAuditMigrations])
  outgoing = new Outbox({ name: 'audited.v1', schema, store: new SqliteOutboxStore(database), now: () => 1000, retryDelayMs: 0 })
})
afterEach(async () => { await outgoing.close(); await database.close() })
async function failed() { const value = await outgoing.enqueue({ secret: 'private payload value' }, { maxAttempts: 1 }); await outgoing.dispatchOnce(reject); return value }
it('commits the actor/reason/result with the retry and preserves immutable message identity', async () => {
  const original = await failed(), result = await outgoing.retryFailedAudited(original.id, request)
  expect(result.result.status).toBe('scheduled')
  expect(result.audit).toMatchObject({ deliveryId: original.id, actor: 'user:42', reason: 'provider-restored', createdAt: 1000, expectedMaxAttempts: 1, additionalAttempts: 1,
    outcome: 'scheduled', result: { state: 'pending', attempts: 1, maxAttempts: 2, lastFailure: 'handler' } })
  const seen: unknown[] = []; await outgoing.dispatchOnce({ async publish(message) { seen.push(message) } })
  expect(seen).toEqual([{ id: original.id, topic: outgoing.name, data: { secret: 'private payload value' } }])
  const history = await outgoing.auditHistory({ deliveryId: original.id }); expect(history.records).toEqual([result.audit])
  expect(JSON.stringify(history)).not.toMatch(/private payload value|leaseToken|payload/)
})
it('records each valid conflict, exhausted-budget and missing result but rejects malformed attribution', async () => {
  const pending = await outgoing.enqueue({ secret: 'pending' }, { maxAttempts: 1 })
  expect((await outgoing.retryFailedAudited(pending.id, request)).audit.outcome).toBe('conflict')
  await outgoing.dispatchOnce(reject)
  expect((await outgoing.retryFailedAudited(pending.id, { ...request, additionalAttempts: 100 })).audit.outcome).toBe('budget-exhausted')
  const missing = await outgoing.retryFailedAudited('missing', request); expect(missing.audit.result).toBeNull(); expect(missing.result.status).toBe('missing')
  await expect(outgoing.retryFailedAudited(pending.id, { ...request, actor: 'bad actor' })).rejects.toThrow('actor')
  await expect(outgoing.retryFailedAudited(pending.id, { ...request, reason: 'raw secret text' })).rejects.toThrow('reason')
  expect((await outgoing.auditHistory()).records).toHaveLength(3)
  expect((await outgoing.get(pending.id))!.maxAttempts).toBe(1)
})
it('rolls back the state/budget if the audit append fails and allows a later valid attempt', async () => {
  const original = await failed()
  await database.execute("CREATE TRIGGER owned_audit_failure BEFORE INSERT ON longhorn_outbox_recovery_audit BEGIN SELECT RAISE(ABORT,'owned audit failure'); END")
  await expect(outgoing.retryFailedAudited(original.id, request)).rejects.toThrow('owned audit failure')
  expect((await outgoing.get(original.id))!).toMatchObject({ state: 'failed', maxAttempts: 1, attempts: 1 })
  expect((await outgoing.auditHistory()).records).toHaveLength(0)
  await database.execute('DROP TRIGGER owned_audit_failure')
  expect((await outgoing.retryFailedAudited(original.id, request)).result.status).toBe('scheduled')
})
it('has one budget winner and one record per competing action with stable filtered/tied pages', async () => {
  const original = await failed(), results = await Promise.all(Array.from({ length: 8 }, () => outgoing.retryFailedAudited(original.id, request)))
  expect(results.filter(value => value.audit.outcome === 'scheduled')).toHaveLength(1)
  expect(results.filter(value => value.audit.outcome === 'conflict')).toHaveLength(7)
  expect(new Set(results.map(value => value.audit.id)).size).toBe(8)
  const first = await outgoing.auditHistory({ limit: 3 }), second = await outgoing.auditHistory({ limit: 3, after: first.nextCursor! }), third = await outgoing.auditHistory({ limit: 3, after: second.nextCursor! })
  expect([...first.records,...second.records,...third.records].map(value => value.id)).toEqual(results.map(value => value.audit.id).sort()); expect(third.nextCursor).toBeNull()
  await expect(outgoing.auditHistory({ deliveryId: original.id, after: first.nextCursor! })).rejects.toThrow('audit cursor')
  expect((await outgoing.auditHistory({ deliveryId: original.id })).records).toHaveLength(8)
  const other = new Outbox({ name: 'other.v1', schema, store: new SqliteOutboxStore(database) })
  try { expect((await other.auditHistory()).records).toHaveLength(0); await expect(other.auditHistory({ after: first.nextCursor! })).rejects.toThrow('cursor') }
  finally { await other.close() }
})
it('retains history after job deletion and prunes only bounded audit rows of its queue', async () => {
  const original = await failed(); await outgoing.retryFailedAudited(original.id, request); await outgoing.dispatchOnce({ async publish() {} })
  expect(await outgoing.prune({ before: 1000 })).toBe(1)
  expect((await outgoing.auditHistory({ deliveryId: original.id })).records).toHaveLength(1)
  expect((await outgoing.retryFailedAudited(original.id, { ...request, expectedMaxAttempts: 2 })).audit.outcome).toBe('missing')
  const other = new Outbox({ name: 'retained.v1', schema, store: new SqliteOutboxStore(database), now: () => 1000 })
  try {
    await other.retryFailedAudited('missing', request)
    expect(await outgoing.pruneAudit({ before: 999 })).toBe(0); expect(await outgoing.pruneAudit({ before: 1000, limit: 1 })).toBe(1)
    expect((await outgoing.auditHistory()).records).toHaveLength(1); expect(await outgoing.pruneAudit({ before: 1000 })).toBe(1)
    expect((await other.auditHistory()).records).toHaveLength(1)
  } finally { await other.close() }
})
it('joins an admitted audited write at close and rejects later audit work', async () => {
  let entered!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve }), gate = new Promise<void>(resolve => { release = resolve })
  class HeldStore extends SqliteOutboxStore {
    override async retryFailedAudited(...args: Parameters<SqliteOutboxStore['retryFailedAudited']>) { entered(); await gate; return super.retryFailedAudited(...args) }
  }
  const held = new Outbox({ name: outgoing.name, schema, store: new HeldStore(database), now: () => 1000 })
  const operation = held.retryFailedAudited('missing', request); await started
  let closed = false; const closing = held.close().then(() => { closed = true })
  try { expect(closed).toBe(false); await expect(held.auditHistory()).rejects.toThrow('closing or closed') }
  finally { release(); await closing }
  expect((await operation).audit.outcome).toBe('missing'); expect((await outgoing.auditHistory()).records).toHaveLength(1)
  await expect(held.pruneAudit({ before: 1000 })).rejects.toThrow('closing or closed')
})
it('fails closed on a legacy schema while leaving ordinary recovery available', async () => {
  const legacyDb = await openSqlite({ filename: ':memory:' })
  await migrate(legacyDb, [...queueMigrations, ...outboxMigrations, ...outboxRecoveryMigrations])
  const legacy = new Outbox({ name: 'legacy.v1', schema, store: new SqliteOutboxStore(legacyDb) })
  try {
    const delivery = await legacy.enqueue({ secret: 'old data' }, { maxAttempts: 1 }); await legacy.dispatchOnce(reject)
    await expect(legacy.retryFailedAudited(delivery.id, request)).rejects.toThrow('longhorn_outbox_recovery_audit')
    expect((await legacy.get(delivery.id))!).toMatchObject({ state: 'failed', maxAttempts: 1 })
    expect((await legacy.retryFailed(delivery.id, { expectedMaxAttempts: 1, additionalAttempts: 1 })).status).toBe('scheduled')
  } finally { await legacy.close(); await legacyDb.close() }
})
