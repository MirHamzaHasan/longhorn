import { expect, it, vi } from 'vitest'
import { Queue } from '@longhorn/queue'
import type { StandardSchemaV1 } from '@longhorn/validation'
import { Scheduler, ScheduleConflictError, ScheduleInputError, SchedulerClosedError, SchedulerStoreError } from './scheduler.js'
import { SchedulerRunner } from './runner.js'
import { MemorySchedulerStore } from './memory.js'
import { MAX_TIMESTAMP } from './cron.js'

const schema: StandardSchemaV1<unknown, { value: number }> = { '~standard': { version: 1, vendor: 'scheduler-test', validate(value) {
  const input = value as { value: number } | undefined
  return typeof input?.value === 'number' ? { value: { value: input.value } } : { issues: [{ message: 'Expected value' }] }
} } }
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done }); return { resolve, promise } }
function setup() {
  let time = 100
  const store = new MemorySchedulerStore()
  const queue = new Queue({ name: 'scheduled.v1', store: store.queueStore, schema, now: () => time })
  const scheduler = new Scheduler({ store, now: () => time })
  return { store, queue, scheduler, setTime: (value: number) => { time = value }, close: async () => { await scheduler.close(); await queue.close() } }
}
it('validates snapshots, dispatches one-time jobs once and separates metadata from queue execution', async () => {
  const { scheduler, queue, setTime, close } = setup()
  const data = { value: 3 }
  const registered = await scheduler.at(queue, data, { id: 'once', at: 110 })
  data.value = 99
  expect(registered).toMatchObject({ state: 'active', firstAt: 110, nextAt: 110, dispatchCount: 0 })
  expect(registered).not.toHaveProperty('payload'); expect(registered).not.toHaveProperty('maxAttempts')
  expect(await scheduler.tick()).toEqual({ dispatched: [], more: false })
  setTime(110)
  const tick = await scheduler.tick()
  expect(tick.dispatched).toEqual([{ scheduleId: 'once', scheduledAt: 110, jobId: 'scheduled:once:110' }])
  expect(await scheduler.get('once')).toMatchObject({ state: 'completed', nextAt: null, dispatchCount: 1, lastJobId: 'scheduled:once:110' })
  expect(await queue.get('scheduled:once:110')).toMatchObject({ state: 'pending', attempts: 0 })
  const handler = vi.fn(); await queue.runOnce(handler)
  expect(handler.mock.calls[0]![0]).toEqual({ value: 3 })
  expect((await scheduler.tick()).dispatched).toEqual([])
  await close()
})
it('ensures explicit IDs without resetting cursors, including defaults first anchored by a different host', async () => {
  const { scheduler, queue, setTime, close } = setup()
  const first = await scheduler.every(queue, { value: 1 }, { id: 'hourly', intervalMs: 10 })
  setTime(110); await scheduler.tick(); setTime(500)
  const existing = await scheduler.every(queue, { value: 1 }, { id: 'hourly', intervalMs: 10 })
  expect(existing).toMatchObject({ firstAt: first.firstAt, nextAt: 120, dispatchCount: 1 })
  await expect(scheduler.every(queue, { value: 2 }, { id: 'hourly', intervalMs: 10 })).rejects.toBeInstanceOf(ScheduleConflictError)
  await expect(scheduler.every(queue, { value: 1 }, { id: 'hourly', intervalMs: 11 })).rejects.toBeInstanceOf(ScheduleConflictError)
  await expect(scheduler.every(queue, { value: 1 }, { id: 'hourly', intervalMs: 10, startAt: 110 })).rejects.toBeInstanceOf(ScheduleConflictError)
  expect(await scheduler.cancel('hourly')).toBe(true)
  expect((await scheduler.every(queue, { value: 1 }, { id: 'hourly', intervalMs: 10 })).state).toBe('cancelled')
  await close()
})
it('coalesces latest interval work and bounds catch-up batches without completion-time drift', async () => {
  const { scheduler, queue, setTime, close } = setup()
  await scheduler.every(queue, { value: 1 }, { id: 'latest', intervalMs: 10, startAt: 100 })
  await scheduler.every(queue, { value: 2 }, { id: 'catchup', intervalMs: 10, startAt: 100, missed: 'catch-up' })
  setTime(135)
  const first = await scheduler.tick({ limit: 3 })
  expect(first.more).toBe(true)
  expect(first.dispatched.map((row) => [row.scheduleId, row.scheduledAt])).toEqual([['catchup', 100], ['latest', 130], ['catchup', 110]])
  const second = await scheduler.tick({ limit: 3 })
  expect(second.dispatched.map((row) => row.scheduledAt)).toEqual([120, 130]); expect(second.more).toBe(false)
  expect(await scheduler.get('latest')).toMatchObject({ nextAt: 140, dispatchCount: 1 })
  expect(await scheduler.get('catchup')).toMatchObject({ nextAt: 140, dispatchCount: 4 })
  setTime(90); expect((await scheduler.tick()).dispatched).toEqual([])
  await close()
})
it('coalesces UTC cron downtime or catches up each due minute with an inclusive explicit start', async () => {
  const { scheduler, queue, setTime, close } = setup()
  setTime(0)
  await scheduler.cron(queue, { value: 1 }, { id: 'cron', expression: '* * * * *', startAt: 0 })
  await scheduler.cron(queue, { value: 1 }, { id: 'cron-catchup', expression: '* * * * *', startAt: 0, missed: 'catch-up' })
  setTime(180_005)
  const tick = await scheduler.tick({ limit: 10 })
  expect(tick.dispatched.filter((row) => row.scheduleId === 'cron').map((row) => row.scheduledAt)).toEqual([180_000])
  expect(tick.dispatched.filter((row) => row.scheduleId === 'cron-catchup').map((row) => row.scheduledAt)).toEqual([0, 60_000, 120_000, 180_000])
  expect((await scheduler.get('cron'))?.nextAt).toBe(240_000)
  await close()
})
it('serializes concurrent tick/cancel operations and keeps already queued jobs after cancellation', async () => {
  const { scheduler, queue, store, close } = setup()
  const other = new Scheduler({ store, now: () => 100 })
  await scheduler.every(queue, { value: 1 }, { id: 'shared', intervalMs: 10, startAt: 100 })
  const ticks = await Promise.all([scheduler.tick(), other.tick(), scheduler.tick()])
  expect(ticks.flatMap((tick) => tick.dispatched)).toHaveLength(1)
  expect(await scheduler.cancel('shared')).toBe(true)
  expect(await scheduler.cancel('shared')).toBe(false)
  expect(await scheduler.cancel('missing')).toBe(false)
  expect((await other.tick()).dispatched).toEqual([])
  expect((await queue.runOnce(() => {})).status).toBe('succeeded')
  await other.close(); await close()
})
it('drains accepted dispatch and registration, stops new calls and does not close borrowed queue/storage', async () => {
  const { scheduler, queue, store, close } = setup()
  const entered = deferred(), release = deferred()
  const dispatch = store.dispatch.bind(store)
  store.dispatch = async (input) => { entered.resolve(); await release.promise; return dispatch(input) }
  await scheduler.at(queue, { value: 1 }, { id: 'drain', at: 100 })
  const pending = scheduler.tick(); await entered.promise
  let closed = false; const closing = scheduler.close().then(() => { closed = true })
  expect(scheduler.close()).toBe(scheduler.close())
  await expect(scheduler.tick()).rejects.toBeInstanceOf(SchedulerClosedError)
  await expect(scheduler.at(queue, { value: 2 }, { at: 100 })).rejects.toBeInstanceOf(SchedulerClosedError)
  expect(closed).toBe(false); release.resolve(); await pending; await closing
  expect((await queue.runOnce(() => {})).status).toBe('succeeded')
  expect((await store.get('drain'))?.dispatchCount).toBe(1)
  await close()
})
it('drains a registration awaiting asynchronous queue validation before closing', async () => {
  const entered = deferred(), release = deferred(), store = new MemorySchedulerStore()
  const asyncSchema: StandardSchemaV1<unknown, { value: number }> = { '~standard': { version: 1, vendor: 'async-test', async validate() {
    entered.resolve(); await release.promise; return { value: { value: 1 } }
  } } }
  const queue = new Queue({ name: 'async.v1', schema: asyncSchema, store: store.queueStore })
  const scheduler = new Scheduler({ store, now: () => 100 })
  const registration = scheduler.at(queue, { value: 1 }, { id: 'accepted', at: 100 })
  await entered.promise
  let closed = false; const closing = scheduler.close().then(() => { closed = true })
  await Promise.resolve(); expect(closed).toBe(false)
  release.resolve(); await registration; await closing
  expect((await store.get('accepted'))?.state).toBe('active')
  await queue.close()
})
it('keeps schema/provider errors distinct, validates boundaries and completes at the timestamp limit', async () => {
  const { scheduler, queue, setTime, store, close } = setup()
  await expect(scheduler.at(queue, { value: 'bad' } as never, { at: 100 })).rejects.toThrow('Validation failed')
  await expect(scheduler.at(queue, { value: Number.NaN }, { at: 100 })).rejects.toThrow('JSON')
  await expect(scheduler.at(queue, { value: 1 }, { at: -1 })).rejects.toThrow('at')
  await expect(scheduler.every(queue, { value: 1 }, { intervalMs: 0 })).rejects.toThrow('intervalMs')
  await expect(scheduler.cron(queue, { value: 1 }, { expression: '0 0 30 2 *' })).rejects.toThrow('no future')
  await expect(scheduler.cron(queue, { value: 1 }, { expression: '@daily' })).rejects.toThrow('cron')
  await expect(scheduler.tick({ limit: 0 })).rejects.toThrow('limit')
  setTime(MAX_TIMESTAMP)
  await scheduler.every(queue, { value: 1 }, { id: 'last', intervalMs: 1, startAt: MAX_TIMESTAMP })
  await scheduler.tick(); expect((await scheduler.get('last'))?.state).toBe('completed')
  store.get = async () => { throw new Error('private provider failure') }
  await expect(scheduler.get('last')).rejects.toBeInstanceOf(SchedulerStoreError)
  await close()
})
it('keeps invalid coordinator clocks outside provider error handling and storage calls', async () => {
  const store = new MemorySchedulerStore()
  const dispatch = vi.spyOn(store, 'dispatch'), cancel = vi.spyOn(store, 'cancel')
  const scheduler = new Scheduler({ store, now: () => Number.NaN })
  await expect(scheduler.tick()).rejects.toBeInstanceOf(ScheduleInputError)
  await expect(scheduler.cancel('any')).rejects.toBeInstanceOf(ScheduleInputError)
  expect(dispatch).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled()
  await scheduler.close()
})
it('runner serializes bounded ticks, wakes idle waits and joins an active tick on close', async () => {
  const { scheduler, queue, store, close } = setup()
  await scheduler.at(queue, { value: 1 }, { at: 100 })
  const entered = deferred(), release = deferred()
  const dispatch = store.dispatch.bind(store)
  store.dispatch = async (input) => { entered.resolve(); await release.promise; return dispatch(input) }
  const runner = new SchedulerRunner(scheduler, { pollIntervalMs: 60_000, batchSize: 1 })
  runner.start(); await entered.promise
  const closing = runner.close(); expect(runner.close()).toBe(closing)
  expect(runner.snapshot()).toMatchObject({ state: 'closing', active: true })
  release.resolve(); await closing
  expect(runner.snapshot()).toMatchObject({ state: 'closed', active: false, dispatched: 1 })
  expect(() => runner.start()).toThrow('once')
  await close()
})
it('runner backs off provider errors and surfaces observer errors after draining', async () => {
  const { scheduler, store, close } = setup()
  const seen = deferred(); const observerError = new Error('observer failed')
  store.dispatch = async () => { throw new Error('offline') }
  const runner = new SchedulerRunner(scheduler, { pollIntervalMs: 60_000, onError: () => { seen.resolve(); throw observerError } })
  runner.start(); await seen.promise
  await expect(runner.close()).rejects.toBe(observerError)
  expect(runner.snapshot()).toMatchObject({ state: 'closed', errors: 1 })
  await close()
})
