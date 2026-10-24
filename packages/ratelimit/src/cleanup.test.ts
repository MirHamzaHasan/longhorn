import { afterEach, expect, it, vi } from 'vitest'
import { RateLimiter } from './index.js'
import { MemoryRateLimitStore } from './memory.js'
import { RateLimitCleanup } from './cleanup.js'

afterEach(() => vi.useRealTimers())
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

it('prunes bounded expired buckets across scopes while preserving live policies', async () => {
  vi.useFakeTimers()
  let time = 100
  const store = new MemoryRateLimitStore({ maxEntries: 10 }), make = (scope: string, windowMs: number) => new RateLimiter({ scope, limit: 1, windowMs, store, now: () => time })
  const first = make('first', 1000), second = make('second', 1000), live = make('live', 10000)
  for (const subject of ['a', 'b']) await first.consume(subject)
  await second.consume('c'); await live.consume('survivor'); time = 1100
  const prune = vi.spyOn(first, 'prune'), cleanup = new RateLimitCleanup(first, { limit: 2, intervalMs: 20 })
  cleanup.start(); await flush(); expect(cleanup.snapshot().removed).toBe(2)
  await vi.advanceTimersByTimeAsync(19); expect(prune).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1); expect(cleanup.snapshot().removed).toBe(3)
  expect((await live.consume('survivor')).allowed).toBe(false)
  await cleanup.close(); expect((await first.consume('a')).allowed).toBe(true)
  await Promise.all([first.close(), second.close(), live.close()]); expect(vi.getTimerCount()).toBe(0)
})

it('uses server-timed pruning without sampling a host clock or consuming subjects', async () => {
  vi.useFakeTimers()
  const consume = vi.fn(), prune = vi.fn(async (_input: { limit: number }) => 0)
  const limiter = new RateLimiter({ scope: 'server', store: { clock: 'server', consume, prune } })
  const cleanup = new RateLimitCleanup(limiter, { limit: 3, intervalMs: 10 })
  cleanup.start(); await flush(); expect(prune).toHaveBeenCalledExactlyOnceWith({ limit: 3 }); expect(consume).not.toHaveBeenCalled()
  await cleanup.close(); await limiter.close()
})

it('drains a real limiter prune before closing borrowed resources, including reentrant close', async () => {
  let release!: () => void, closing!: Promise<void>, closed = false
  const limiter = new RateLimiter({ scope: 'held', store: { async consume() { throw new Error('unused') }, async prune() {
    closing = cleanup.close(); void closing.then(() => { closed = true }); await new Promise<void>(done => { release = done }); return 1
  } } })
  const cleanup = new RateLimitCleanup(limiter); cleanup.start(); await flush(); expect(closed).toBe(false)
  release(); await closing; expect(cleanup.snapshot()).toMatchObject({ state: 'closed', removed: 1 }); expect(closed).toBe(true)
  // Cleanup borrowed the limiter: it remains open for explicit maintenance.
  const limiterClosing = limiter.close(); await limiterClosing
})

it('continues after a closed borrowed limiter fails, then drains error observation', async () => {
  vi.useFakeTimers()
  const limiter = new RateLimiter({ scope: 'closed', store: new MemoryRateLimitStore() }); await limiter.close()
  const errors: unknown[] = [], cleanup = new RateLimitCleanup(limiter, { intervalMs: 10, onError: error => { errors.push(error) } })
  cleanup.start(); await flush(); await vi.advanceTimersByTimeAsync(10); await cleanup.close()
  expect(errors).toHaveLength(2); expect(cleanup.snapshot()).toMatchObject({ runs: 2, removed: 0, errors: 2, state: 'closed' })
})
