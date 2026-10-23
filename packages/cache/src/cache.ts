import { validateKey, validateTtl } from './types.js'
import type { CacheLookup, CacheOptions, CacheStore, CacheWriteOptions } from './types.js'

type State = 'open' | 'closing' | 'closed'
type Flight<T> = { promise: Promise<T> }
type Slot<T> = { users: number; generation: object; tail: Promise<void>; flight: Flight<T> | undefined }
type StoreOperation = 'get' | 'set' | 'delete' | 'clear' | 'close'

export class CacheClosedError extends Error {
  constructor() { super('Cache is closing or closed'); this.name = 'CacheClosedError' }
}
export class CacheStoreError extends Error {
  constructor(readonly operation: StoreOperation, cause: unknown) {
    super(`Cache store ${operation} failed`, { cause }); this.name = 'CacheStoreError'
  }
}

/** One value type and one exclusively-owned store per cache. No global state. */
export class Cache<T> {
  private readonly slots = new Map<string, Slot<T>>()
  private readonly pending = new Set<Promise<void>>()
  private barrier: Promise<void> = Promise.resolve()
  private epoch: object = {}
  private current: State = 'open'
  private closing: Promise<void> | undefined
  private readonly ttlMs: number | null
  private readonly copy: (value: T) => T

  constructor(private readonly store: CacheStore<T>, options: CacheOptions<T> = {}) {
    this.ttlMs = options.ttlMs === undefined ? 60000 : options.ttlMs
    validateTtl(this.ttlMs)
    // Some Web hosts require the global receiver for structuredClone.
    this.copy = options.copy ?? ((value) => globalThis.structuredClone(value))
    if (typeof this.copy !== 'function') throw new TypeError('Cache copy must be a function')
  }
  get state(): State { return this.current }

  async get(key: string): Promise<CacheLookup<T>> {
    return this.run(key, async (slot) => {
      const entry = await this.queue(slot, () => this.fromStore('get', () => this.store.get(key)))
      return entry.hit ? Object.freeze({ hit: true, value: this.copy(entry.value), expiresAt: entry.expiresAt }) : Object.freeze({ hit: false })
    })
  }
  async set(key: string, value: T, options: CacheWriteOptions = {}): Promise<void> {
    this.assertOpen(); validateKey(key)
    const ttl = this.ttl(options)
    const snapshot = ttl === 0 ? value : this.copy(value)
    return this.run(key, async (slot) => {
      this.invalidate(slot)
      await this.queue(slot, () => this.fromStore('set', () => this.store.set(key, snapshot, ttl)))
    })
  }
  async delete(key: string): Promise<void> {
    return this.run(key, async (slot) => {
      this.invalidate(slot)
      await this.queue(slot, () => this.fromStore('delete', () => this.store.delete(key)))
    })
  }
  async clear(): Promise<void> {
    this.assertOpen()
    this.epoch = {}
    for (const slot of this.slots.values()) slot.flight = undefined
    const before = [this.barrier, ...[...this.slots.values()].map((slot) => slot.tail)]
    const operation = Promise.all(before).then(() => this.fromStore('clear', () => this.store.clear()))
    this.barrier = operation.then(() => {}, () => {})
    return this.track(() => operation)
  }
  async getOrLoad(key: string, loader: () => T | Promise<T>, options: CacheWriteOptions = {}): Promise<T> {
    this.assertOpen(); validateKey(key)
    if (typeof loader !== 'function') throw new TypeError('Cache loader must be a function')
    const ttl = this.ttl(options)
    return this.run(key, async (slot) => {
      if (slot.flight) return this.copy(await slot.flight.promise)
      const generation = slot.generation
      const epoch = this.epoch
      const flight: Flight<T> = { promise: (async () => {
        const entry = await this.queue(slot, () => this.fromStore('get', () => this.store.get(key)))
        if (entry.hit) return entry.value
        // Backend work stays outside store queues; invalidation need not await it.
        const value = this.copy(await loader())
        await this.queue(slot, async () => {
          if (this.current !== 'open' || generation !== slot.generation || epoch !== this.epoch) return
          await this.fromStore('set', () => this.store.set(key, value, ttl))
        })
        return value
      })() }
      slot.flight = flight
      try { return this.copy(await flight.promise) } finally { if (slot.flight === flight) slot.flight = undefined }
    })
  }
  close(): Promise<void> { this.closing ??= this.shutdown(); return this.closing }

  private ttl(options: CacheWriteOptions): number | null {
    const ttl = options.ttlMs === undefined ? this.ttlMs : options.ttlMs
    validateTtl(ttl)
    return ttl
  }
  private assertOpen(): void { if (this.current !== 'open') throw new CacheClosedError() }
  private invalidate(slot: Slot<T>): void { slot.generation = {}; slot.flight = undefined }
  private async fromStore<R>(operation: StoreOperation, work: () => Promise<R>): Promise<R> {
    try { return await work() } catch (cause) { throw new CacheStoreError(operation, cause) }
  }
  private queue<R>(slot: Slot<T>, work: () => Promise<R>): Promise<R> {
    const operation = Promise.all([slot.tail, this.barrier]).then(work)
    slot.tail = operation.then(() => {}, () => {})
    return operation
  }
  private run<R>(key: string, work: (slot: Slot<T>) => Promise<R>): Promise<R> {
    this.assertOpen(); validateKey(key)
    const slot = this.slots.get(key) ?? { users: 0, generation: {}, tail: Promise.resolve(), flight: undefined }
    slot.users++; this.slots.set(key, slot)
    return this.track(async () => {
      try { return await work(slot) } finally {
        slot.users--
        if (slot.users === 0 && !slot.flight) this.slots.delete(key)
      }
    })
  }
  private track<R>(work: () => Promise<R>): Promise<R> {
    let finish!: () => void
    const completion = new Promise<void>((resolve) => { finish = resolve })
    this.pending.add(completion)
    return (async () => {
      try { return await work() } finally { this.pending.delete(completion); finish() }
    })()
  }
  private async shutdown(): Promise<void> {
    this.current = 'closing'
    while (this.pending.size) await Promise.all([...this.pending])
    try { await this.fromStore('close', () => this.store.close()) } finally {
      this.slots.clear(); this.current = 'closed'
    }
  }
}
