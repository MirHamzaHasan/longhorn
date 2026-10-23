import { Queue, QueueClosedError } from '../../packages/queue/dist/index.js'
import { MemoryQueueStore } from '../../packages/queue/dist/memory.js'

const check = (value, message) => { if (!value) throw new Error(message) }
const schema = { '~standard': { version: 1, vendor: 'native-queue-qa', validate(value) {
  return typeof value?.value === 'number' ? { value: { value: value.value } } : { issues: [{ message: 'Expected value' }] }
} } }
export async function verifyQueue() {
  let now = 100
  const store = new MemoryQueueStore()
  const queue = new Queue({ name: 'qa.v1', schema, store, now: () => now, leaseMs: 90, retryDelayMs: 10 })
  const job = await queue.enqueue({ value: 3 }, { delayMs: 10, maxAttempts: 2 })
  check(!('payload' in job) && !('leaseToken' in job), 'Status leaked internals')
  check((await queue.runOnce(() => {})).status === 'idle', 'Delay ignored')
  now = 110
  check((await queue.runOnce(() => { throw new Error('private failure') })).status === 'retrying', 'Retry missing')
  check((await queue.get(job.id)).availableAt === 120, 'Backoff missing')
  now = 120
  check((await queue.runOnce((data) => check(data.value === 3, 'Wrong payload'))).status === 'succeeded', 'Retry failed')

  const orphan = await queue.enqueue({ value: 4 }, { maxAttempts: 2 })
  await store.claim({ queue: queue.name, token: 'dead', now, leaseMs: 90 })
  now = 210
  const reclaimed = await store.claim({ queue: queue.name, token: 'live', now, leaseMs: 90 })
  check(reclaimed.id === orphan.id && reclaimed.attempts === 2, 'Crash not recovered')
  check(!await store.complete({ queue: queue.name, id: orphan.id, token: 'dead', now }), 'Stale acknowledgement accepted')
  check(await store.complete({ queue: queue.name, id: orphan.id, token: 'live', now }), 'Live acknowledgement rejected')

  await queue.enqueue({ value: 5 })
  let release, started
  const gate = new Promise((resolve) => { release = resolve })
  const entered = new Promise((resolve) => { started = resolve })
  const run = queue.runOnce(async () => { started(); await gate })
  await entered
  let closed = false
  const closing = queue.close().then(() => { closed = true })
  let rejected = false
  try { await queue.enqueue({ value: 6 }) } catch (error) { rejected = error instanceof QueueClosedError }
  check(rejected && !closed, 'Queue did not stop admission and drain')
  release(); check((await run).status === 'succeeded', 'Accepted work abandoned')
  await closing
  return { verified: true, retries: true, fenced: true, drained: true }
}
