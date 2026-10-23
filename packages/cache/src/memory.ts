import { validateKey, validateTtl } from './types.js'
import type { CacheLookup, CacheStore } from './types.js'

type Entry<T> = { readonly value: T; readonly expiresAt: number | null }

/** Bounded LRU storage with lazy expiry. Cache owns value copying and concurrency. */
export class MemoryCacheStore<T> implements CacheStore<T> {
  private readonly entries = new Map<string, Entry<T>>()
  private readonly capacity: number
  private readonly clock: () => number
  private closed = false

  constructor(options: { maxEntries?: number; clock?: () => number } = {}) {
    this.capacity = options.maxEntries ?? 1000
    if (!Number.isSafeInteger(this.capacity) || this.capacity < 1) throw new RangeError('Cache capacity must be a positive safe integer')
    this.clock = options.clock ?? Date.now
  }
  private assertOpen(): void { if (this.closed) throw new Error('Memory cache store is closed') }
  private now(): number {
    const now = this.clock()
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid cache clock')
    return now
  }
  private prune(now: number): void {
    for (const [key, entry] of this.entries) if (entry.expiresAt !== null && entry.expiresAt <= now) this.entries.delete(key)
  }
  get size(): number { this.assertOpen(); this.prune(this.now()); return this.entries.size }

  async get(key: string): Promise<CacheLookup<T>> {
    this.assertOpen(); validateKey(key)
    const entry = this.entries.get(key)
    if (!entry) return { hit: false }
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return { hit: false }
    }
    this.entries.delete(key); this.entries.set(key, entry)
    return { hit: true, value: entry.value, expiresAt: entry.expiresAt }
  }
  async set(key: string, value: T, ttlMs: number | null): Promise<void> {
    this.assertOpen(); validateKey(key); validateTtl(ttlMs)
    const now = this.now()
    if (ttlMs === 0) { this.entries.delete(key); return }
    const expiresAt = ttlMs === null ? null : now + ttlMs
    if (expiresAt !== null && !Number.isSafeInteger(expiresAt)) throw new RangeError('Cache expiry exceeds the supported clock range')
    this.prune(now)
    this.entries.delete(key)
    this.entries.set(key, { value, expiresAt })
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!)
  }
  async delete(key: string): Promise<void> { this.assertOpen(); validateKey(key); this.entries.delete(key) }
  async clear(): Promise<void> { this.assertOpen(); this.entries.clear() }
  async close(): Promise<void> { this.closed = true; this.entries.clear() }
}
