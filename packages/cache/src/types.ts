export type CacheLookup<T> =
  | { readonly hit: false }
  | { readonly hit: true; readonly value: T; readonly expiresAt: number | null }
export type CacheWriteOptions = { readonly ttlMs?: number | null }
export type CacheOptions<T> = {
  /** Defaults to 60 seconds. null explicitly disables expiry; zero retains no entry. */
  readonly ttlMs?: number | null
  /** Defaults to structuredClone. Must preserve T and provide the desired isolation. */
  readonly copy?: (value: T) => T
}

/** Exclusively owned by one Cache. Store values are borrowed internal snapshots. */
export interface CacheStore<T> {
  get(key: string): Promise<CacheLookup<T>>
  set(key: string, value: T, ttlMs: number | null): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  close(): Promise<void>
}

export function validateKey(key: string): void {
  if (typeof key !== 'string' || !key) throw new TypeError('Cache key must be a nonempty string')
}
export function validateTtl(ttl: number | null): void {
  if (ttl !== null && (!Number.isSafeInteger(ttl) || ttl < 0)) throw new RangeError('Cache TTL must be a nonnegative safe integer or null')
}
