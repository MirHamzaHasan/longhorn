import { afterEach, expect, it, vi } from 'vitest'
import { PruneWorker } from './prune-worker.js'
afterEach(() => vi.useRealTimers())
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

it('validates a pruner and owned bounds before creating work', () => {
  for (const target of [undefined, {}, { prune: 1 }]) expect(() => new PruneWorker(target as never)).toThrow('requires a pruner')
  for (const options of [{ limit: 0 }, { limit: 10001 }, { intervalMs: 0 }, { intervalMs: 2147483648 }, { onError: 1 }]) expect(() => new PruneWorker({ prune: async () => 0 }, options as never)).toThrow('Invalid cleanup')
})
it('retains even an undefined observer failure while reaching closed', async () => {
  const worker = new PruneWorker({ prune: async () => { throw new Error('private') } }, { onError() { throw undefined } })
  worker.start(); await flush(); await expect(worker.close()).rejects.toBeUndefined(); expect(worker.snapshot()).toMatchObject({ state: 'closed', observerErrors: 1 })
})
it('waits after invalid counts and drains an asynchronously rejecting observer', async () => {
  vi.useFakeTimers(); let release!: () => void
  const problem = new Error('observation failed'), prune = vi.fn(async () => 101)
  const worker = new PruneWorker({ prune }, { onError: async () => { await new Promise<void>(done => { release = done }); throw problem } })
  worker.start(); await flush(); const closing = worker.close(), rejected = expect(closing).rejects.toBe(problem)
  await vi.advanceTimersByTimeAsync(100000); expect(prune).toHaveBeenCalledTimes(1); expect(worker.snapshot().active).toBe(true)
  release(); await rejected; expect(vi.getTimerCount()).toBe(0)
})
