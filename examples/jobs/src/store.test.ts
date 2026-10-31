import { afterEach, describe, expect, it } from 'vitest'
import { migrate } from '@longhornjs/database'
import type { Database } from '@longhornjs/database'
import { openSqlite } from '@longhornjs/node/sqlite'
import { MemoryQueueStore } from '@longhornjs/queue/memory'
import { queueMigrations, SqliteQueueStore } from '@longhornjs/queue/sqlite'
import type { QueueStore } from '@longhornjs/queue'

const databases: Database[] = []
afterEach(async () => { await Promise.all(databases.map((database) => database.close())); databases.length = 0 })

for (const provider of ['memory', 'sqlite'] as const) {
  describe(`${provider} queue store contract`, () => {
    async function setup(): Promise<QueueStore> {
      if (provider === 'memory') return new MemoryQueueStore()
      const database = await openSqlite({ filename: ':memory:' }); databases.push(database)
      expect(await migrate(database, queueMigrations)).toEqual(['longhorn_queue/001_jobs'])
      expect(await migrate(database, queueMigrations)).toEqual([])
      return new SqliteQueueStore(database)
    }
    const input = (id: string, queue = 'contract') => ({ id, queue, payload: '{"ok":true}', now: 10, availableAt: 20, maxAttempts: 2 })
    it('isolates queues, orders due work deterministically and provides one owner', async () => {
      const store = await setup()
      await Promise.all(['b', 'a', 'c'].map((id) => store.enqueue(input(id))))
      await store.enqueue(input('a', 'other'))
      await expect(store.enqueue(input('a'))).rejects.toThrow()
      expect(await store.get('missing', 'a')).toBeUndefined()
      expect(await store.claim({ queue: 'contract', token: 'early', now: 19, leaseMs: 30 })).toBeUndefined()
      const claims = await Promise.all([1, 2, 3, 4].map((id) => store.claim({ queue: 'contract', token: `token${id}`, now: 20, leaseMs: 30 })))
      expect(claims.filter(Boolean).map((job) => job!.id)).toEqual(['a', 'b', 'c'])
      expect(claims[3]).toBeUndefined()
      const a = claims[0]!
      expect(a).toMatchObject({ state: 'running', attempts: 1, leaseUntil: 50, leaseToken: 'token1' })
      expect((await store.get('other', 'a'))?.state).toBe('pending')
      const info = await store.get('contract', 'a')
      ;(info as { state: string }).state = 'failed'
      expect((await store.get('contract', 'a'))?.state).toBe('running')
    })
    it('requires a live token for completion, retry, and monotonic renewal', async () => {
      const store = await setup()
      await store.enqueue(input('job'))
      await store.claim({ queue: 'contract', token: 'owner', now: 20, leaseMs: 30 })
      const owned = { queue: 'contract', id: 'job', token: 'owner', now: 21 }
      expect(await store.complete({ ...owned, token: 'wrong' })).toBe(false)
      expect(await store.fail({ ...owned, token: 'wrong', retryAt: 30, reason: 'handler' })).toBe(false)
      expect(await store.renew({ ...owned, leaseMs: 10 })).toBe(true)
      expect((await store.get('contract', 'job'))?.leaseUntil).toBe(50)
      expect(await store.renew({ ...owned, now: 49, leaseMs: 30 })).toBe(true)
      expect((await store.get('contract', 'job'))?.leaseUntil).toBe(79)
      expect(await store.fail({ ...owned, now: 50, retryAt: 60, reason: 'handler' })).toBe(true)
      expect(await store.complete(owned)).toBe(false)
      const retry = await store.claim({ queue: 'contract', token: 'retry', now: 60, leaseMs: 30 })
      expect(retry).toMatchObject({ attempts: 2, lastFailure: 'handler' })
      expect(await store.fail({ ...owned, token: 'retry', now: 61, retryAt: 70, reason: 'handler' })).toBe(true)
      expect((await store.get('contract', 'job'))?.state).toBe('failed')
      expect(await store.claim({ queue: 'contract', token: 'exhausted', now: 100, leaseMs: 30 })).toBeUndefined()
    })
    it('recovers crashes at the lease boundary and fences every stale transition', async () => {
      const store = await setup()
      await store.enqueue(input('job'))
      await store.claim({ queue: 'contract', token: 'dead', now: 20, leaseMs: 30 })
      const stale = { queue: 'contract', id: 'job', token: 'dead', now: 50 }
      expect(await store.complete(stale)).toBe(false)
      expect(await store.renew({ ...stale, leaseMs: 30 })).toBe(false)
      expect(await store.fail({ ...stale, retryAt: 60, reason: 'handler' })).toBe(false)
      expect(await store.claim({ queue: 'contract', token: 'next', now: 50, leaseMs: 30 })).toMatchObject({ attempts: 2, lastFailure: 'lease-expired' })
      expect(await store.complete({ ...stale, now: 51 })).toBe(false)
      expect(await store.claim({ queue: 'contract', token: 'none', now: 80, leaseMs: 30 })).toBeUndefined()
      expect(await store.get('contract', 'job')).toMatchObject({ state: 'failed', attempts: 2, lastFailure: 'lease-expired', leaseToken: null, leaseUntil: null })
    })
    it('retains completed jobs without accepting later changes', async () => {
      const store = await setup()
      await store.enqueue(input('job'))
      await store.claim({ queue: 'contract', token: 'owner', now: 20, leaseMs: 30 })
      const owner = { queue: 'contract', id: 'job', token: 'owner', now: 21 }
      expect(await store.complete(owner)).toBe(true)
      expect(await store.complete(owner)).toBe(false)
      expect(await store.fail({ ...owner, retryAt: 30, reason: 'handler' })).toBe(false)
      expect(await store.claim({ queue: 'contract', token: 'later', now: 100, leaseMs: 30 })).toBeUndefined()
      expect(await store.get('contract', 'job')).toMatchObject({ state: 'succeeded', attempts: 1, leaseUntil: null })
    })
  })
}
