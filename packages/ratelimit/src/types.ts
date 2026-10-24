export type RateLimitReservation = {
  readonly scope: string
  /** SHA-256 digest; raw subjects never reach a built-in store. */
  readonly key: string
  readonly limit: number
  readonly windowMs: number
}
export type StoredRateLimit = { readonly allowed: boolean; readonly remaining: number; readonly resetsAt: number }
export type RateLimitDecision = StoredRateLimit & { readonly retryAfterMs: number }
export interface RateLimitStore {
  readonly clock?: 'application'
  /** Sample now exactly once after native ownership; publish the result only after commit. */
  consume(request: RateLimitReservation, now: () => number): Promise<StoredRateLimit>
  /** Table-wide bounded maintenance, without timers or borrowed database closure. */
  prune(input: { readonly now: number; readonly limit: number }): Promise<number>
}

/** Server samples its clock atomically with the reservation; callers supply no time. */
export type ServerTimedRateLimit = StoredRateLimit & { readonly observedAt: number }
export interface ServerTimedRateLimitStore {
  readonly clock: 'server'
  consume(request: RateLimitReservation): Promise<ServerTimedRateLimit>
  /** A server with native TTL can return zero without scanning or resetting live keys. */
  prune(input: { readonly limit: number }): Promise<number>
}
export type RateLimitStorage = RateLimitStore | ServerTimedRateLimitStore
