import { afterEach, describe, expect, it } from 'vitest'
import { migrate } from '@longhorn/database'
import type { Database } from '@longhorn/database'
import { openSqlite } from '@longhorn/node/sqlite'
import { Queue } from '@longhorn/queue'
import { queueMigrations, SqliteQueueStore } from '@longhorn/queue/sqlite'
import { Scheduler } from '@longhorn/scheduler'
import { MemorySchedulerStore } from '@longhorn/scheduler/memory'
import { schedulerMigrations, SqliteSchedulerStore } from '@longhorn/scheduler/sqlite'
import { z } from 'zod'

const databases: Database[] = []
const resources: { close: () => Promise<void> }[] = []
afterEach(async () => {
  for (const resource of resources.splice(0).reverse()) await resource.close()
  for (const database of databases.splice(0)) await database.close()
})
const schema = z.object({ value: z.number() })
for (const provider of ['memory', 'sqlite'] as const) {
  describe(`${provider} schedule storage contract`, () => {
    async function setup() {
      let store, queueStore
      if (provider === 'memory') { const memory = new MemorySchedulerStore(); store = memory; queueStore = memory.queueStore }
      else {
        const database = await openSqlite({ filename: ':memory:' }); databases.push(database)
        await migrate(database, [...queueMigrations, ...schedulerMigrations])
        expect(await migrate(database, [...queueMigrations, ...schedulerMigrations])).toEqual([])
        store = new SqliteSchedulerStore(database); queueStore = new SqliteQueueStore(database)
      }
      const queue = new Queue({ name: 'contract.v1', store: queueStore, schema, now: () => 200 })
      const one = new Scheduler({ store, now: () => 200 }), two = new Scheduler({ store, now: () => 200 })
      resources.push(queue, one, two)
      return { one, two, queue, store, queueStore }
    }
    it('registers immutable definitions once, serializes dispatch and pairs cursor changes with queued occurrences', async () => {
      const { one, two, queue, store } = await setup()
      const registrations = await Promise.all([one, two].map((scheduler) => scheduler.every(queue, { value: 1 }, {
        id: 'shared', intervalMs: 10, startAt: 180, missed: 'catch-up',
      })))
      expect(registrations[0]).toEqual(registrations[1])
      const results = await Promise.all([one.tick({ limit: 2 }), two.tick({ limit: 2 })])
      const occurrences = results.flatMap((result) => result.dispatched)
      expect(occurrences.map((row) => row.scheduledAt)).toEqual([180, 190, 200])
      expect(new Set(occurrences.map((row) => row.jobId)).size).toBe(3)
      expect(await one.get('shared')).toMatchObject({ nextAt: 210, dispatchCount: 3 })
      const raw = await store.get('shared')
      ;(raw!.timing as { kind: string }).kind = 'once'
      expect((await store.get('shared'))?.timing.kind).toBe('interval')
      expect((await queue.runOnce(() => {})).status).toBe('succeeded')
    })
    it('cancels future work, preserves dispatched jobs, and does not revive cancelled definitions', async () => {
      const { one, two, queue } = await setup()
      await one.every(queue, { value: 2 }, { id: 'cancelled', intervalMs: 10, startAt: 200 })
      await one.tick()
      expect(await two.cancel('cancelled')).toBe(true)
      expect(await one.cancel('cancelled')).toBe(false)
      expect((await one.tick()).dispatched).toEqual([])
      expect((await one.every(queue, { value: 2 }, { id: 'cancelled', intervalMs: 10, startAt: 200 })).state).toBe('cancelled')
      expect(await queue.get('scheduled:cancelled:200')).toMatchObject({ state: 'pending' })
    })
    it('coalesces missed interval work and completes overdue one-time schedules', async () => {
      const { one, queue } = await setup()
      await one.every(queue, { value: 1 }, { id: 'latest', intervalMs: 10, startAt: 100 })
      await one.at(queue, { value: 2 }, { id: 'once', at: 150 })
      const result = await one.tick()
      expect(result.dispatched.map((row) => row.scheduledAt)).toEqual([200, 150])
      expect(await one.get('latest')).toMatchObject({ dispatchCount: 1, nextAt: 210 })
      expect(await one.get('once')).toMatchObject({ state: 'completed', nextAt: null })
    })
  })
}

it('rolls back queue insertion if the schedule cursor write fails, allowing the same occurrence to retry', async () => {
  const database = await openSqlite({ filename: ':memory:' }); databases.push(database)
  await migrate(database, [...queueMigrations, ...schedulerMigrations])
  let failUpdate = true
  const wrapped: Database = {
    execute: (input) => database.execute(input), close: () => database.close(),
    transaction: (work) => database.transaction((tx) => work({ execute: (input) => {
      const sql = typeof input === 'string' ? input : input.sql
      if (failUpdate && sql.startsWith('UPDATE longhorn_schedules SET state = ?')) throw new Error('Expected cursor write failure')
      return tx.execute(input)
    } })),
  }
  const scheduler = new Scheduler({ store: new SqliteSchedulerStore(wrapped), now: () => 100 })
  const queue = new Queue({ name: 'rollback.v1', store: new SqliteQueueStore(database), schema, now: () => 100 })
  resources.push(queue, scheduler)
  await scheduler.at(queue, { value: 1 }, { id: 'atomic', at: 100 })
  await expect(scheduler.tick()).rejects.toMatchObject({ name: 'SchedulerStoreError', operation: 'dispatch' })
  expect(await queue.get('scheduled:atomic:100')).toBeUndefined()
  expect(await scheduler.get('atomic')).toMatchObject({ state: 'active', dispatchCount: 0, nextAt: 100 })
  failUpdate = false
  expect((await scheduler.tick()).dispatched).toHaveLength(1)
  expect(await queue.get('scheduled:atomic:100')).toMatchObject({ state: 'pending' })
})
