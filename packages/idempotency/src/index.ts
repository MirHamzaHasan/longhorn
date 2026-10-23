import type { SqlExecutor } from '@longhorn/database'
import { jsonSnapshot } from './json.js'

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }
export type StoredRequest = {
  readonly scope: string; readonly key: string; readonly fingerprint: string
  readonly retentionMs: number; readonly now: () => number
}
export type StoredResult = { readonly result: string; readonly replayed: boolean; readonly expiresAt: number }
/** Implementations must hold native ownership through business writes and result persistence in one transaction. */
export interface IdempotencyStore {
  run(request: StoredRequest, work: (transaction: SqlExecutor) => Promise<string>): Promise<StoredResult>
  prune(input: { readonly now: number; readonly limit: number }): Promise<number>
}
export class IdempotencyConflictError extends Error {
  constructor() { super('Idempotency key was already used with different input'); this.name = 'IdempotencyConflictError' }
}
export class IdempotencyInputError extends Error {
  constructor(message: string) { super(message); this.name = 'IdempotencyInputError' }
}
export function validIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)
}
function bounded(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new IdempotencyInputError(`Invalid ${name}`)
  return value
}
export function idempotencyTime(now: () => number): number {
  const value = now()
  if (!Number.isSafeInteger(value) || value < 0) throw new IdempotencyInputError('Invalid idempotency clock')
  return value
}
export type IdempotencyOptions = {
  readonly store: IdempotencyStore; readonly retentionMs?: number; readonly now?: () => number
  readonly maxInputBytes?: number; readonly maxResultBytes?: number
}
/** Replays a bounded JSON result. Borrows its store/database; callers own migrations and shutdown. */
export class Idempotency {
  private readonly store: IdempotencyStore
  private readonly retentionMs: number
  private readonly now: () => number
  private readonly maxInputBytes: number
  private readonly maxResultBytes: number
  constructor(options: IdempotencyOptions) {
    this.store = options.store; this.now = options.now ?? Date.now
    this.retentionMs = bounded(options.retentionMs ?? 86_400_000, 'retentionMs', 2_592_000_000)
    this.maxInputBytes = bounded(options.maxInputBytes ?? 16_384, 'maxInputBytes', 1_048_576)
    this.maxResultBytes = bounded(options.maxResultBytes ?? 65_536, 'maxResultBytes', 1_048_576)
  }
  async run<T extends JsonValue>(request: { readonly scope: string; readonly key: string; readonly input: JsonValue }, work: (transaction: SqlExecutor) => Promise<T>): Promise<{ readonly value: T; readonly replayed: boolean; readonly expiresAt: number }> {
    const { scope, key } = request
    if (typeof scope !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(scope)) throw new IdempotencyInputError('Invalid idempotency scope')
    if (!validIdempotencyKey(key)) throw new IdempotencyInputError('Invalid idempotency key')
    // Snapshot before the first await; object property order does not change intent.
    const input = jsonSnapshot(request.input, this.maxInputBytes)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
    const fingerprint = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
    const result = await this.store.run({ scope, key, fingerprint, retentionMs: this.retentionMs, now: this.now }, async tx => jsonSnapshot(await work(tx), this.maxResultBytes))
    return { value: JSON.parse(result.result) as T, replayed: result.replayed, expiresAt: result.expiresAt }
  }
  prune(limit = 100): Promise<number> {
    return this.store.prune({ now: idempotencyTime(this.now), limit: bounded(limit, 'prune limit', 10_000) })
  }
}
