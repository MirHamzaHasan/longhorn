import { Queue } from '../../packages/queue/dist/index.js'
import { Scheduler, ScheduleConflictError, SchedulerClosedError } from '../../packages/scheduler/dist/index.js'
import { MemorySchedulerStore } from '../../packages/scheduler/dist/memory.js'
import { CronExpression } from '../../packages/scheduler/dist/cron.js'

const check = (value, message) => { if (!value) throw new Error(message) }
const schema = { '~standard': { version: 1, vendor: 'scheduler-native', validate(value) {
  return typeof value?.value === 'number' ? { value: { value: value.value } } : { issues: [{ message: 'Invalid value' }] }
} } }
export async function verifyScheduler() {
  let now = 100
  const store = new MemorySchedulerStore()
  const queue = new Queue({ name: 'qa.v1', schema, store: store.queueStore, now: () => now })
  const one = new Scheduler({ store, now: () => now }), two = new Scheduler({ store, now: () => now })
  try {
    await one.every(queue, { value: 1 }, { id: 'catchup', intervalMs: 10, startAt: 100, missed: 'catch-up' })
    await two.every(queue, { value: 1 }, { id: 'catchup', intervalMs: 10, startAt: 100, missed: 'catch-up' })
    await one.every(queue, { value: 2 }, { id: 'latest', intervalMs: 10, startAt: 100 })
    now = 135
    const ticks = await Promise.all([one.tick({ limit: 3 }), two.tick({ limit: 3 })])
    const occurrences = ticks.flatMap((tick) => tick.dispatched)
    check(occurrences.length === 5 && new Set(occurrences.map((item) => item.jobId)).size === 5, 'Duplicate/missing dispatch')
    check((await one.get('catchup')).dispatchCount === 4 && (await one.get('latest')).dispatchCount === 1, 'Wrong missed-run policy')
    let conflict = false
    try { await one.every(queue, { value: 9 }, { id: 'latest', intervalMs: 10, startAt: 100 }) } catch (error) { conflict = error instanceof ScheduleConflictError }
    check(conflict, 'Definition changed under existing ID')
    await one.cancel('catchup'); await two.cancel('latest')
    now = 200; check((await one.tick()).dispatched.length === 0, 'Cancellation ignored')
    check((await queue.runOnce(() => {})).status === 'succeeded', 'Cancellation deleted accepted queue work')
    const cron = new CronExpression('0 0 29 2 *')
    check(cron.next(Date.parse('2096-02-29T00:00:00Z')) === Date.parse('2104-02-29T00:00:00Z'), 'Cron century boundary failed')
    await one.cron(queue, { value: 3 }, { id: 'utc', expression: '* * * * *', startAt: 0 })
    now = 180_001
    check((await one.tick()).dispatched[0].scheduledAt === 180_000, 'Cron coalescing failed')
    await one.cancel('utc')
    await one.at(queue, { value: 4 }, { id: 'once', at: now })
    const pending = one.tick(); const closing = one.close()
    check((await pending).dispatched.length === 1, 'Accepted tick abandoned')
    await closing
    let closed = false
    try { await one.tick() } catch (error) { closed = error instanceof SchedulerClosedError }
    check(closed, 'Closed scheduler admitted work')
    return { verified: true, policies: true, shared: true, cron: true, drained: true }
  } finally { await one.close(); await two.close(); await queue.close() }
}
