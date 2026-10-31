import { afterEach, beforeEach, expect, it } from 'vitest'
import { migrate } from '@longhornjs/database'
import type { Database } from '@longhornjs/database'
import { openSqlite } from '@longhornjs/node/sqlite'
import { Outbox } from '@longhornjs/outbox'
import { SqliteOutboxStore, outboxMigrations, outboxRecoveryMigrations } from '@longhornjs/outbox/sqlite'
import { queueMigrations } from '@longhornjs/queue/sqlite'
import { z } from 'zod'
let database: Database, outgoing: Outbox<{ secret: string }>, now: number
const schema = z.object({ secret: z.string() })
const reject = { async publish() { throw new Error('owned publisher failure') } }
beforeEach(async () => {
  database = await openSqlite({ filename: ':memory:' }); now = 1000
  await migrate(database, [...queueMigrations, ...outboxMigrations, ...outboxRecoveryMigrations])
  outgoing = new Outbox({ name: 'recover.v1', schema, store: new SqliteOutboxStore(database), now: () => now, leaseMs: 100, retryDelayMs: 0 })
})
afterEach(async () => { await outgoing.close(); await database.close() })
it('pages one scoped state with stable ties and explicit metadata only', async () => {
  const ids: string[] = []
  for (let i = 0; i < 5; i++) ids.push((await outgoing.enqueue({ secret: 'never expose payload' })).id)
  const first = await outgoing.list({ state: 'pending', limit: 2 })
  expect(first.deliveries.map(value => value.id)).toEqual([...ids].sort().slice(0,2)); expect(first.nextCursor).not.toBeNull()
  const second = await outgoing.list({ state: 'pending', limit: 2, after: first.nextCursor! })
  const third = await outgoing.list({ state: 'pending', limit: 2, after: second.nextCursor! })
  expect([...first.deliveries,...second.deliveries,...third.deliveries].map(value => value.id)).toEqual([...ids].sort()); expect(third.nextCursor).toBeNull()
  expect(JSON.stringify(first)).not.toMatch(/payload|leaseToken|never expose/)
  expect((await outgoing.list()).deliveries).toHaveLength(0)
  await expect(outgoing.list({ after: first.nextCursor! })).rejects.toThrow('cursor')
  const other = new Outbox({ name: 'other.v1', schema, store: new SqliteOutboxStore(database) })
  try { expect((await other.list({ state: 'pending' })).deliveries).toHaveLength(0); await expect(other.list({ state: 'pending', after: first.nextCursor! })).rejects.toThrow('cursor') }
  finally { await other.close() }
})
it('raises a failed record ceiling exactly once under contention and preserves ID, payload and lifetime attempts', async () => {
  const original = await outgoing.enqueue({ secret: 'immutable' }, { maxAttempts: 1 }); await outgoing.dispatchOnce(reject)
  const results = await Promise.all(Array.from({ length: 8 }, () => outgoing.retryFailed(original.id, { expectedMaxAttempts: 1, additionalAttempts: 2, delayMs: 10 })))
  expect(results.filter(value => value.status === 'scheduled')).toHaveLength(1); expect(results.filter(value => value.status === 'conflict')).toHaveLength(7)
  const pending = (await outgoing.get(original.id))!
  expect(pending).toMatchObject({ id: original.id, attempts: 1, maxAttempts: 3, state: 'pending', availableAt: 1010, lastFailure: 'handler' })
  expect((await outgoing.dispatchOnce({ async publish() {} })).status).toBe('idle'); now = 1010
  const seen: unknown[] = []; await outgoing.dispatchOnce({ async publish(message, context) { seen.push(message); expect(context.attempt).toBe(2) } })
  expect(seen).toEqual([{ id: original.id, topic: outgoing.name, data: { secret: 'immutable' } }])
  expect((await outgoing.retryFailed(original.id, { expectedMaxAttempts: 3 })).status).toBe('conflict')
})
it('rejects a stale request after another failure even at the same clock time; enforces lifetime cap', async () => {
  const original = await outgoing.enqueue({ secret: 'same clock' }, { maxAttempts: 1 }); await outgoing.dispatchOnce(reject)
  expect((await outgoing.retryFailed(original.id, { expectedMaxAttempts: 1, additionalAttempts: 1 })).status).toBe('scheduled')
  await outgoing.dispatchOnce(reject)
  expect((await outgoing.retryFailed(original.id, { expectedMaxAttempts: 1, additionalAttempts: 1 })).status).toBe('conflict')
  expect((await outgoing.retryFailed(original.id, { expectedMaxAttempts: 2, additionalAttempts: 99 })).status).toBe('budget-exhausted')
  expect((await outgoing.get(original.id))!.maxAttempts).toBe(2)
  expect((await outgoing.retryFailed(original.id, { expectedMaxAttempts: 2, additionalAttempts: 98 })).status).toBe('scheduled')
  const current = (await outgoing.get(original.id))!; expect(current.attempts).toBe(2); expect(current.maxAttempts).toBe(100)
})
it('refuses pending/running/succeeded/missing records and never recreates pruned messages', async () => {
  const original = await outgoing.enqueue({ secret: 'states' }, { maxAttempts: 1 })
  expect((await outgoing.retryFailed(original.id, { expectedMaxAttempts: 1 })).status).toBe('conflict')
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { entered = resolve })
  const publishing = outgoing.dispatchOnce({ async publish() { entered(); await gate } })
  await started
  try {
    expect((await outgoing.retryFailed(original.id, { expectedMaxAttempts: 1 })).status).toBe('conflict')
    const running = await outgoing.list({ state: 'running' }); expect(running.deliveries[0]!.id).toBe(original.id)
    expect(running.deliveries[0]!.leaseUntil).toBe(now+100); expect(running.deliveries[0]).not.toHaveProperty('leaseToken')
  } finally { release(); await publishing }
  expect((await outgoing.retryFailed(original.id, { expectedMaxAttempts: 1 })).status).toBe('conflict')
  expect(await outgoing.prune({ before: now })).toBe(1)
  expect((await outgoing.retryFailed(original.id, { expectedMaxAttempts: 1 })).status).toBe('missing')
  expect((await outgoing.list({ state: 'pending' })).deliveries).toHaveLength(0)
})
it('fences a stale publisher after final lease expiry and deliberate retry', async () => {
  const store = new SqliteOutboxStore(database), original = await outgoing.enqueue({ secret: 'stale' }, { maxAttempts: 1 })
  const stale = await store.claim({ queue: outgoing.queueName, token: 'old-token', now, leaseMs: 100 }); expect(stale!.id).toBe(original.id)
  now += 100; expect((await outgoing.dispatchOnce(reject)).status).toBe('idle')
  expect((await outgoing.get(original.id))!.state).toBe('failed')
  expect((await outgoing.retryFailed(original.id, { expectedMaxAttempts: 1, additionalAttempts: 1 })).status).toBe('scheduled')
  const current = await store.claim({ queue: outgoing.queueName, token: 'new-token', now, leaseMs: 100 }); expect(current!.attempts).toBe(2)
  expect(await store.complete({ queue: outgoing.queueName, id: original.id, token: 'old-token', now })).toBe(false)
  expect(await store.complete({ queue: outgoing.queueName, id: original.id, token: 'new-token', now })).toBe(true)
})
it('validates bounds/cursors/retry input and joins accepted recovery work at close', async () => {
  await expect(outgoing.list({ limit: 101 })).rejects.toThrow('list limit')
  await expect(outgoing.retryFailed('id', { expectedMaxAttempts: 0 })).rejects.toThrow('expectedMaxAttempts')
  await expect(outgoing.retryFailed('id', { expectedMaxAttempts: 1, delayMs: Number.MAX_SAFE_INTEGER })).rejects.toThrow('timestamp')
  const listing = outgoing.list({ state: 'pending' }), closing = outgoing.close()
  expect((await listing).deliveries).toHaveLength(0); await closing
  await expect(outgoing.list()).rejects.toThrow('closing or closed')
  await expect(outgoing.retryFailed('id', { expectedMaxAttempts: 1 })).rejects.toThrow('closing or closed')
})
