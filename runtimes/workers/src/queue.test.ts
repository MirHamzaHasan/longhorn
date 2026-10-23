import { expect, it, vi } from 'vitest'
import { Longhorn } from '@longhorn/core'
import { createQueueWorker, QueueBatchError } from './queue.js'
import type { QueueDecision, WorkerQueueBatch, WorkerQueueMessage } from './queue.js'
import type { WorkerExecutionContext } from './index.js'
const context = (): WorkerExecutionContext => ({ waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} })
const message = (id = 'one'): WorkerQueueMessage => ({ id, timestamp: new Date(1000), body: { private: 'body' }, attempts: 1, ack: vi.fn(), retry: vi.fn() })
const batch = (messages = [message()]): WorkerQueueBatch => ({ queue: 'reports', messages, ackAll: vi.fn(), retryAll: vi.fn() })
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { resolve, promise } }
const ack = (): QueueDecision => ({ action: 'ack' })

it('preserves platform identity/method ownership and the exact registered completion with shared Fetch startup', async () => {
  const start = vi.fn(), app = new Longhorn<{ name: string }>().onStart(start), item = message(), event = batch([item]), bindings = { name: 'native' }, ctx = context()
  item.ack = function () { expect(this).toBe(item) }
  // The platform registration is synchronous, before startup or callbacks.
  let registered: Promise<unknown> | undefined
  ctx.waitUntil = function (promise) { expect(this).toBe(ctx); registered = promise; expect(start).not.toHaveBeenCalled() }
  app.http.get('/', c => c.text(c.env.name))
  const worker = createQueueWorker(app, { handle: invocation => {
    expect(invocation.batch).toBe(event); expect(invocation.message).toBe(item)
    expect(invocation.bindings).toBe(bindings); expect(invocation.context).toBe(ctx)
    return ack()
  } })
  const pending = worker.queue(event, bindings, ctx); expect(registered).toBe(pending)
  await pending; expect(await (await worker.fetch(new Request('http://local/'), bindings, context())).text()).toBe('native')
  expect(start).toHaveBeenCalledTimes(1); expect(event.ackAll).not.toHaveBeenCalled(); expect(event.retryAll).not.toHaveBeenCalled()
  await worker.close(); expect(app.state).toBe('running'); await app.close()
})
it('bounds batches/messages independently, keeps bindings separate, and snapshots the admitted array', async () => {
  const app = new Longhorn<{ name: string }>(), release = deferred(), entered = deferred(), names: string[] = []
  const worker = createQueueWorker(app, { maxConcurrentBatches: 2, messageConcurrency: 2, handle: async ({ bindings }) => {
    names.push(bindings.name); if (names.length === 4) entered.resolve(); await release.promise; return ack()
  } })
  const items = [message('a'), message('b'), message('c')], first = batch(items)
  const one = worker.queue(first, { name: 'one' }, context()), two = worker.queue(batch([message('d'), message('e')]), { name: 'two' }, context())
  items.push(message('not-admitted'))
  await entered.promise; expect(worker.stats()).toMatchObject({ activeBatches: 2, activeMessages: 4 })
  await expect(worker.queue(batch(), { name: 'overflow' }, context())).rejects.toMatchObject({ name: 'QueueCapacityError' })
  release.resolve(); await Promise.all([one, two]); expect(names.filter(name => name === 'one')).toHaveLength(3)
  expect(names.filter(name => name === 'two')).toHaveLength(2); expect(worker.stats().acked).toBe(5)
  await worker.close(); await app.close()
})
it('continues partial batches and preserves original failures in input order while applying explicit ack/retry', async () => {
  const app = new Longhorn(), items = ['ack', 'failure', 'retry', 'undefined'].map(message), original = { domain: 'original' }, summaries: unknown[] = []
  items[2]!.retry = function (options) { expect(this).toBe(items[2]); expect(options).toEqual({ delaySeconds: 0 }) }
  const worker = createQueueWorker(app, { handle: ({ message }) => {
    if (message.id === 'failure') throw original
    if (message.id === 'undefined') throw undefined
    return message.id === 'retry' ? { action: 'retry', delaySeconds: 0 } : ack()
  }, afterBatch: ({ summary }) => { summaries.push(summary) } })
  const error = await worker.queue(batch(items), {}, context()).catch(error => error)
  expect(error).toBeInstanceOf(QueueBatchError); expect(error.errors).toEqual([original, undefined])
  expect(items[0]!.ack).toHaveBeenCalledTimes(1); expect(items[1]!.ack).not.toHaveBeenCalled()
  expect(summaries).toEqual([{ attempted: 4, acked: 1, retried: 1, failed: 2, skipped: 0 }])
  expect(worker.stats()).toMatchObject({ failedBatches: 1, failedMessages: 2, acked: 1, retried: 1, activeMessages: 0 })
  expect(JSON.stringify(worker.stats())).not.toContain('private'); await worker.close(); await app.close()
})
it('requires valid decisions and never silently acknowledges missing/invalid policy', async () => {
  const app = new Longhorn(), invalid = [undefined, { action: 'ack', extra: true }, { action: 'retry', delaySeconds: -1 }, { action: 'retry', delaySeconds: 86401 }, { action: 'retry', delaySeconds: 0.5 }]
  const items = invalid.map((_, index) => message(String(index)))
  const worker = createQueueWorker(app, { handle: ({ message }) => invalid[Number(message.id)] as QueueDecision })
  const error = await worker.queue(batch(items), {}, context()).catch(error => error)
  expect(error.errors).toHaveLength(invalid.length); expect(error.errors.every((error: Error) => error.name === 'QueueDecisionError')).toBe(true)
  for (const item of items) { expect(item.ack).not.toHaveBeenCalled(); expect(item.retry).not.toHaveBeenCalled() }
  await worker.close(); await app.close()
})
it('validates every message before startup, rejecting the whole malformed/oversize batch without decisions', async () => {
  const start = vi.fn(), app = new Longhorn().onStart(start), handle = vi.fn(ack), worker = createQueueWorker(app, { handle, maxBatchSize: 1 })
  const events = [batch([message(), message('two')]), batch([{ ...message(), attempts: 0 }]), batch([{ ...message(), timestamp: new Date(NaN) }]), batch([{ ...message(), id: '\n' }]), { ...batch(), queue: '' }]
  for (const event of events) await expect(worker.queue(event, {}, context())).rejects.toMatchObject({ name: 'QueueBatchInputError' })
  const duplicate = createQueueWorker(app, { handle })
  await expect(duplicate.queue(batch([message(), message()]), {}, context())).rejects.toMatchObject({ name: 'QueueBatchInputError' })
  expect(start).not.toHaveBeenCalled(); expect(handle).not.toHaveBeenCalled(); await worker.close(); await duplicate.close(); await app.close()
})
it('validates construction bounds and snapshots options/callbacks', async () => {
  const app = new Longhorn()
  for (const options of [{ maxConcurrentBatches: 0 }, { messageConcurrency: 65 }, { maxBatchSize: 101 }, { timeoutMs: 900001 }, { timeoutMs: NaN }]) {
    expect(() => createQueueWorker(app, { handle: ack, ...options })).toThrow('Invalid queue')
  }
  const options = { handle: vi.fn(ack), maxBatchSize: 1 }, handle = options.handle, worker = createQueueWorker(app, options)
  options.handle = vi.fn(() => { throw new Error('mutated') }); options.maxBatchSize = 100
  await worker.queue(batch(), {}, context()); expect(handle).toHaveBeenCalledTimes(1)
  await expect(worker.queue(batch([message(), message('two')]), {}, context())).rejects.toMatchObject({ name: 'QueueBatchInputError' })
  await worker.close(); await app.close()
})
it('retains ignored-abort callbacks and resources, skips unstarted messages, and drains adapter/core close', async () => {
  const stopped = vi.fn(), app = new Longhorn().onStart(() => stopped), entered = deferred(), release = deferred(), items = [message(), message('later')]
  const worker = createQueueWorker(app, { timeoutMs: 10, messageConcurrency: 1, handle: async () => { entered.resolve(); await release.promise; return ack() } })
  const pending = worker.queue(batch(items), {}, context()), observed = expect(pending).rejects.toBeInstanceOf(QueueBatchError)
  await entered.promise; await vi.waitFor(() => expect(worker.stats().timedOut).toBe(1))
  expect(worker.stats()).toMatchObject({ activeBatches: 1, activeMessages: 1 })
  const closing = worker.close(), appClosing = app.close(); expect(worker.close()).toBe(closing); expect(stopped).not.toHaveBeenCalled()
  await expect(worker.queue(batch(), {}, context())).rejects.toMatchObject({ name: 'QueueClosedError' })
  release.resolve(); await observed; await closing; await appClosing
  expect(stopped).toHaveBeenCalledTimes(1); expect(worker.stats()).toMatchObject({ skippedMessages: 1, acked: 0, closed: true })
  for (const item of items) expect(item.ack).not.toHaveBeenCalled()
})
it('passes cooperative abort to handlers without retrying them locally', async () => {
  const app = new Longhorn(), handle = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); signal.throwIfAborted(); return ack()
  }), worker = createQueueWorker(app, { timeoutMs: 10, handle })
  const error = await worker.queue(batch(), {}, context()).catch(error => error)
  expect(error.errors.some((error: Error) => error.name === 'QueueTimeoutError')).toBe(true)
  expect(handle).toHaveBeenCalledTimes(1); expect(worker.stats().acked).toBe(0); await worker.close(); await app.close()
})
it('owns awaited afterBatch work and preserves its rejection after successful explicit decisions', async () => {
  const app = new Longhorn(), entered = deferred(), flush = deferred(), original = new Error('flush failed'), item = message()
  const worker = createQueueWorker(app, { timeoutMs: 10, handle: ack, afterBatch: async ({ summary }) => {
    expect(summary.acked).toBe(1); entered.resolve(); await flush.promise; throw original
  } })
  const pending = worker.queue(batch([item]), {}, context()), observed = expect(pending).rejects.toMatchObject({ errors: [original, expect.objectContaining({ name: 'QueueTimeoutError' })] })
  await entered.promise; expect(item.ack).toHaveBeenCalledTimes(1); expect(worker.stats().activeBatches).toBe(1)
  await vi.waitFor(() => expect(worker.stats().timedOut).toBe(1)); expect(worker.stats().activeBatches).toBe(1)
  const closing = worker.close(), appClosing = app.close(); flush.resolve(); await observed; await closing; await appClosing
})
it('includes startup in the budget and never enters late handlers or afterBatch', async () => {
  const startup = deferred(), app = new Longhorn().onStart(() => startup.promise), handle = vi.fn(ack), afterBatch = vi.fn()
  const worker = createQueueWorker(app, { timeoutMs: 10, handle, afterBatch }), pending = worker.queue(batch(), {}, context())
  const observed = expect(pending).rejects.toMatchObject({ name: 'QueueTimeoutError' })
  await vi.waitFor(() => expect(worker.stats().timedOut).toBe(1)); expect(worker.stats().activeBatches).toBe(1)
  startup.resolve(); await observed; expect(handle).not.toHaveBeenCalled(); expect(afterBatch).not.toHaveBeenCalled()
  await worker.close(); await app.close()
})
it('preserves startup and waitUntil registration errors without entering user work', async () => {
  const original = new Error('startup'), app = new Longhorn().onStart(() => { throw original }), handle = vi.fn(ack), worker = createQueueWorker(app, { handle })
  await expect(worker.queue(batch(), {}, context())).rejects.toBe(original); expect(handle).not.toHaveBeenCalled(); await worker.close(); await app.close()
  const start = vi.fn(), other = new Longhorn().onStart(start), ctx = context(), registration = new Error('registration')
  ctx.waitUntil = () => { throw registration }
  const second = createQueueWorker(other, { handle })
  await expect(second.queue(batch(), {}, ctx)).rejects.toBe(registration)
  expect(start).not.toHaveBeenCalled(); expect(handle).not.toHaveBeenCalled(); await second.close(); await other.close()
})
it('treats a failed native decision call as a message failure and still processes later messages', async () => {
  const app = new Longhorn(), original = new Error('ack failed'), first = message('first'), second = message('second')
  first.ack = () => { throw original }
  const worker = createQueueWorker(app, { messageConcurrency: 1, handle: ack })
  await expect(worker.queue(batch([first, second]), {}, context())).rejects.toMatchObject({ errors: [original] })
  expect(second.ack).toHaveBeenCalledTimes(1); expect(worker.stats()).toMatchObject({ failedMessages: 1, acked: 1 })
  await worker.close(); await app.close()
})
