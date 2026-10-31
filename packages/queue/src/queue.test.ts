import { describe, expect, it, vi } from 'vitest'
import type { StandardSchemaV1 } from '@longhornjs/validation'
import { Queue, QueueClosedError, QueueStoreError } from './queue.js'
import { MemoryQueueStore } from './memory.js'
import { QueueWorker } from './worker.js'

type Data = { value: number }
const schema: StandardSchemaV1<unknown, Data> = { '~standard': { version: 1, vendor: 'queue-test', validate: (input) => {
  const value = input as Data | undefined
  return typeof value?.value === 'number' ? { value: { value: value.value } } : { issues: [{ message: 'Expected a value' }] }
} } }
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function fixture(options: { leaseMs?: number; retryDelayMs?: number } = {}) {
  let time = 100
  const store = new MemoryQueueStore()
  const queue = new Queue({ name: 'test.v1', schema, store, now: () => time, ...options })
  return { queue, store, setTime: (value: number) => { time = value } }
}

describe('typed durable queue coordination', () => {
  it('prepares validated integration payloads without inserting or retaining caller references', async () => {
    const { queue } = fixture()
    const data = { value: 3 }
    const prepared = await queue.prepare(data, { maxAttempts: 5 })
    data.value = 99
    expect(prepared).toEqual({ queue: queue.name, payload: '{"value":3}', maxAttempts: 5 })
    expect((await queue.runOnce(() => {})).status).toBe('idle')
    await queue.close()
    await expect(queue.prepare(data)).rejects.toBeInstanceOf(QueueClosedError)
  })
  it('rejects timestamp overflow before entering storage without classifying it as a provider failure', async () => {
    const store = new MemoryQueueStore(), insert = vi.spyOn(store, 'enqueue')
    const queue = new Queue({ name: 'overflow', schema, store, now: () => Number.MAX_SAFE_INTEGER })
    const error = await queue.enqueue({ value: 1 }, { delayMs: 1 }).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(Error); expect(error).not.toBeInstanceOf(QueueStoreError)
    expect(insert).not.toHaveBeenCalled()
    await queue.close()
  })
  it('preserves ID-generation failures without calling or blaming storage', async () => {
    const { queue, store } = fixture()
    const insert = vi.spyOn(store, 'enqueue'), failure = new Error('ID source unavailable')
    const random = vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => { throw failure })
    try {
      await expect(queue.enqueue({ value: 1 })).rejects.toBe(failure)
      expect(insert).not.toHaveBeenCalled()
    } finally { random.mockRestore(); await queue.close() }
  })
  it('snapshots validated JSON, hides payload/tokens, respects delay and isolates names', async () => {
    const { queue, store, setTime } = fixture()
    const input = { value: 1 }; const job = await queue.enqueue(input, { delayMs: 5 })
    input.value = 2
    expect(job).not.toHaveProperty('payload'); expect(job).not.toHaveProperty('leaseToken')
    expect((await store.get(queue.name, job.id))?.payload).toBe('{"value":1}')
    expect(await queue.runOnce(() => {})).toEqual({ status: 'idle' })
    const other = new Queue({ name: 'other', schema, store })
    expect(await other.get(job.id)).toBeUndefined()
    setTime(105)
    const handler = vi.fn()
    expect(await queue.runOnce(handler)).toEqual({ status: 'succeeded', id: job.id })
    expect(handler.mock.calls[0]![0]).toEqual({ value: 1 })
    expect((await queue.get(job.id))?.attempts).toBe(1)
    await Promise.all([queue.close(), other.close()])
  })
  it('runs a claimed job once under concurrent consumers and retries with bounded backoff', async () => {
    const { queue, setTime } = fixture({ retryDelayMs: 10 })
    const job = await queue.enqueue({ value: 1 }, { maxAttempts: 3 })
    const started = deferred(), release = deferred()
    const first = queue.runOnce(async () => { started.resolve(); await release.promise; throw new Error('sensitive') }, { heartbeat: false })
    await started.promise
    expect(await queue.runOnce(() => {})).toEqual({ status: 'idle' })
    release.resolve()
    expect(await first).toEqual({ status: 'retrying', id: job.id })
    expect(await queue.get(job.id)).toMatchObject({ attempts: 1, availableAt: 110, lastFailure: 'handler' })
    expect(JSON.stringify(await queue.get(job.id))).not.toContain('sensitive')
    setTime(110)
    expect((await queue.runOnce(() => { throw null })).status).toBe('retrying')
    expect((await queue.get(job.id))?.availableAt).toBe(130)
    setTime(130)
    expect((await queue.runOnce(() => { throw new Error() })).status).toBe('failed')
    expect((await queue.get(job.id))?.attempts).toBe(3)
    expect((await queue.runOnce(() => {})).status).toBe('idle')
    await queue.close()
  })
  it('reclaims expired leases, fences stale owners and exhausts a crashed last attempt', async () => {
    const { queue, store, setTime } = fixture({ leaseMs: 30 })
    const job = await queue.enqueue({ value: 1 }, { maxAttempts: 2 })
    const first = await store.claim({ queue: queue.name, now: 100, leaseMs: 30, token: 'one' })
    expect(first?.attempts).toBe(1)
    const second = await store.claim({ queue: queue.name, now: 130, leaseMs: 30, token: 'two' })
    expect(second).toMatchObject({ id: job.id, attempts: 2, leaseToken: 'two' })
    const ownership = { queue: queue.name, id: job.id, now: 131, token: 'one' }
    expect(await store.complete(ownership)).toBe(false)
    expect(await store.renew({ ...ownership, leaseMs: 100 })).toBe(false)
    expect(await store.fail({ ...ownership, retryAt: null, reason: 'handler' })).toBe(false)
    setTime(160)
    expect((await queue.runOnce(() => {})).status).toBe('idle')
    expect(await queue.get(job.id)).toMatchObject({ state: 'failed', attempts: 2, lastFailure: 'lease-expired', leaseUntil: null })
    await queue.close()
  })
  it('a late handler cannot acknowledge a lease claimed by another consumer', async () => {
    const { queue, setTime } = fixture({ leaseMs: 30 })
    const job = await queue.enqueue({ value: 1 })
    const started = deferred(), release = deferred()
    const old = queue.runOnce(async () => { started.resolve(); await release.promise }, { heartbeat: false })
    await started.promise; setTime(130)
    expect((await queue.runOnce(() => {})).status).toBe('succeeded')
    release.resolve()
    expect((await old).status).toBe('lost')
    expect(await queue.get(job.id)).toMatchObject({ state: 'succeeded', attempts: 2 })
    await queue.close()
  })
  it('renews long-running work and aborts a handler on lost ownership', async () => {
    vi.useFakeTimers()
    try {
      const { queue, store, setTime } = fixture({ leaseMs: 90 })
      const job = await queue.enqueue({ value: 1 })
      const started = deferred(), release = deferred()
      let signal!: AbortSignal
      const running = queue.runOnce(async (_, context) => { signal = context.signal; started.resolve(); await release.promise })
      await started.promise; setTime(130); await vi.advanceTimersByTimeAsync(30)
      expect((await store.get(queue.name, job.id))?.leaseUntil).toBe(220)
      setTime(220)
      await store.claim({ queue: queue.name, now: 220, leaseMs: 90, token: 'replacement' })
      await vi.advanceTimersByTimeAsync(30)
      expect(signal.aborted).toBe(true)
      release.resolve(); expect((await running).status).toBe('lost')
      await queue.close(); expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
  it('surfaces heartbeat/provider failures and never records them as handler errors', async () => {
    vi.useFakeTimers()
    try {
      const { queue, store } = fixture({ leaseMs: 90 })
      await queue.enqueue({ value: 1 })
      const started = deferred(), aborted = deferred()
      store.renew = async () => { throw new Error('database unavailable') }
      const running = queue.runOnce(async (_, context) => {
        started.resolve(); context.signal.addEventListener('abort', () => aborted.resolve(), { once: true }); await aborted.promise
      })
      const rejected = expect(running).rejects.toMatchObject({ name: 'QueueStoreError', operation: 'renew' })
      await started.promise; await vi.advanceTimersByTimeAsync(30); await rejected
      store.claim = async () => { throw new Error('offline') }
      await expect(queue.runOnce(() => {})).rejects.toBeInstanceOf(QueueStoreError)
      await queue.close()
    } finally { vi.useRealTimers() }
  })
  it('terminally rejects persisted invalid payloads without invoking the handler', async () => {
    const { queue, store } = fixture()
    await store.enqueue({ id: 'invalid', queue: queue.name, payload: '{"value":"bad"}', now: 100, availableAt: 100, maxAttempts: 3 })
    const handler = vi.fn()
    expect((await queue.runOnce(handler)).status).toBe('failed')
    expect(handler).not.toHaveBeenCalled()
    expect(await queue.get('invalid')).toMatchObject({ state: 'failed', attempts: 1, lastFailure: 'invalid-payload' })
    await queue.close()
  })
  it('drains accepted work, rejects new admission and leaves borrowed storage open', async () => {
    const { queue, store } = fixture()
    const job = await queue.enqueue({ value: 1 })
    const started = deferred(), release = deferred()
    const running = queue.runOnce(async () => { started.resolve(); await release.promise })
    await started.promise
    let closed = false
    const closing = queue.close().then(() => { closed = true })
    expect(queue.close()).toBe(queue.close())
    await expect(queue.enqueue({ value: 2 })).rejects.toBeInstanceOf(QueueClosedError)
    await expect(queue.get(job.id)).rejects.toBeInstanceOf(QueueClosedError)
    await expect(queue.runOnce(() => {})).rejects.toBeInstanceOf(QueueClosedError)
    expect(closed).toBe(false)
    release.resolve(); await running; await closing
    expect((await store.get(queue.name, job.id))?.state).toBe('succeeded')
  })
  it('rejects invalid options, non-JSON data and oversized payloads before storing', async () => {
    const { queue } = fixture()
    await expect(queue.enqueue({ value: Number.NaN })).rejects.toThrow('JSON')
    await expect(queue.enqueue({ value: 1 }, { maxAttempts: 0 })).rejects.toThrow('maxAttempts')
    await expect(queue.enqueue({ value: 1 }, { delayMs: -1 })).rejects.toThrow('delayMs')
    await expect(queue.enqueue({ value: 'bad' } as never)).rejects.toThrow('Validation failed')
    expect(() => new Queue({ name: 'bad/name', store: new MemoryQueueStore(), schema })).toThrow('queue name')
    const echo: StandardSchemaV1<unknown, unknown> = { '~standard': { version: 1, vendor: 'test', validate: (value) => ({ value }) } }
    const raw = new Queue({ name: 'raw', schema: echo, store: new MemoryQueueStore(), maxPayloadBytes: 10 })
    for (const value of [undefined, new Date(), BigInt(1), () => {}, [, 1], { value: undefined }]) {
      await expect(raw.enqueue(value)).rejects.toThrow()
    }
    const cycle: unknown[] = []; cycle.push(cycle)
    await expect(raw.enqueue(cycle)).rejects.toThrow('acyclic')
    await expect(raw.enqueue('a'.repeat(10))).rejects.toThrow('maxPayloadBytes')
    await Promise.all([queue.close(), raw.close()])
  })
})

describe('host-owned worker', () => {
  it('bounds concurrency and drains handlers before queue/database cleanup', async () => {
    const { queue } = fixture()
    await Promise.all([1, 2, 3].map((value) => queue.enqueue({ value })))
    const started = deferred(), release = deferred()
    let active = 0, peak = 0, count = 0
    const worker = new QueueWorker(queue, async () => {
      count++; active++; peak = Math.max(peak, active)
      if (active === 2) started.resolve()
      await release.promise; active--
    }, { concurrency: 2, pollIntervalMs: 60_000 })
    worker.start(); await started.promise
    const closing = worker.close()
    expect(worker.close()).toBe(closing)
    expect(worker.snapshot()).toMatchObject({ state: 'closing', active: 2 })
    release.resolve(); await closing
    expect({ count, peak }).toEqual({ count: 2, peak: 2 })
    expect(worker.snapshot()).toMatchObject({ state: 'closed', active: 0 })
    await queue.close()
    expect(() => worker.start()).toThrow('once')
  })
  it('yields a continuously ready memory backlog to host timers', async () => {
    const { queue } = fixture()
    await Promise.all(Array.from({ length: 100 }, (_, value) => queue.enqueue({ value })))
    let count = 0
    const worker = new QueueWorker(queue, () => { count++ })
    const timer = new Promise<void>((resolve) => setTimeout(resolve, 0))
    worker.start(); await timer
    await worker.close()
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThan(100)
    await queue.close()
  })
  it('backs off operational failures, wakes idle polls and surfaces observer failures on close', async () => {
    const { queue, store } = fixture()
    const observed = deferred()
    store.claim = async () => { throw new Error('offline') }
    const observerError = new Error('observer failed')
    const worker = new QueueWorker(queue, () => {}, { pollIntervalMs: 60_000,
      onError: () => { observed.resolve(); throw observerError } })
    worker.start(); await observed.promise
    await expect(worker.close()).rejects.toBe(observerError)
    expect(worker.snapshot()).toMatchObject({ state: 'closed', errors: 1 })
    await queue.close()
  })
})
