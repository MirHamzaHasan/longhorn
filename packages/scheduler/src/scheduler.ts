import type { Queue } from '@longhornjs/queue'
import { CronExpression, MAX_TIMESTAMP } from './cron.js'
import { scheduleInfo } from './types.js'
import type { MissedPolicy, ScheduleInfo, ScheduleTiming, SchedulerStore, TickResult } from './types.js'

export class SchedulerClosedError extends Error {
  constructor() { super('Scheduler is closing or closed'); this.name = 'SchedulerClosedError' }
}
export class SchedulerStoreError extends Error {
  constructor(readonly operation: keyof SchedulerStore, cause: unknown) {
    super(`Scheduler store ${operation} failed`, { cause }); this.name = 'SchedulerStoreError'
  }
}
export class ScheduleInputError extends Error {
  constructor(message: string) { super(message); this.name = 'ScheduleInputError' }
}
export class ScheduleConflictError extends Error {
  constructor(readonly id: string) { super('Schedule ID already has a different definition'); this.name = 'ScheduleConflictError' }
}
export type ScheduleOptions = { readonly id?: string; readonly maxAttempts?: number }
export type AtOptions = ScheduleOptions & { readonly at: number }
export type EveryOptions = ScheduleOptions & { readonly intervalMs: number; readonly startAt?: number; readonly missed?: MissedPolicy }
export type CronOptions = ScheduleOptions & { readonly expression: string; readonly startAt?: number; readonly missed?: MissedPolicy }
export type SchedulerOptions = { readonly store: SchedulerStore; readonly now?: () => number }
function timestamp(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) throw new ScheduleInputError(`Invalid ${label}`)
  return value
}
function policy(value: MissedPolicy | undefined): MissedPolicy {
  if (value !== undefined && value !== 'latest' && value !== 'catch-up') throw new ScheduleInputError('Invalid missed-run policy')
  return value ?? 'latest'
}

/** Durable definitions/cursors. Timing hosts and queue workers have separate ownership. */
export class Scheduler {
  private readonly store: SchedulerStore
  private readonly clock: () => number
  private readonly active = new Set<Promise<void>>()
  private closing: Promise<void> | undefined
  constructor(options: SchedulerOptions) { this.store = options.store; this.clock = options.now ?? Date.now }
  private now() { return timestamp(this.clock(), 'scheduler clock') }
  private accept<R>(work: () => Promise<R>): Promise<R> {
    if (this.closing) return Promise.reject(new SchedulerClosedError())
    const result = Promise.resolve().then(work)
    const settled = result.then(() => {}, () => {})
    this.active.add(settled); void settled.then(() => this.active.delete(settled))
    return result
  }
  private async provider<R>(operation: keyof SchedulerStore, work: () => Promise<R>): Promise<R> {
    try { return await work() } catch (cause) { throw new SchedulerStoreError(operation, cause) }
  }
  private async register<T>(queue: Queue<T>, data: T, options: ScheduleOptions, timing: ScheduleTiming, missed: MissedPolicy, firstAt: number): Promise<ScheduleInfo> {
    const id = options.id ?? crypto.randomUUID()
    if (!/^[a-zA-Z0-9._-]{1,100}$/.test(id)) throw new ScheduleInputError('Invalid schedule ID')
    const prepared = await queue.prepare(data, options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts })
    const input = { ...prepared, id, timing, missed, firstAt, now: this.now() }
    const stored = await this.provider('create', () => this.store.create(input))
    if (stored.queue !== prepared.queue || stored.payload !== prepared.payload || stored.maxAttempts !== prepared.maxAttempts ||
      stored.missed !== missed || JSON.stringify(stored.timing) !== JSON.stringify(timing)) throw new ScheduleConflictError(id)
    return scheduleInfo(stored)
  }
  at<T>(queue: Queue<T>, data: NoInfer<T>, options: AtOptions): Promise<ScheduleInfo> {
    return this.accept(() => {
      const at = timestamp(options.at, 'at')
      return this.register(queue, data, options, { kind: 'once', at }, 'latest', at)
    })
  }
  every<T>(queue: Queue<T>, data: NoInfer<T>, options: EveryOptions): Promise<ScheduleInfo> {
    return this.accept(() => {
      if (!Number.isSafeInteger(options.intervalMs) || options.intervalMs < 1 || options.intervalMs > MAX_TIMESTAMP) throw new ScheduleInputError('Invalid intervalMs')
      const startAt = options.startAt === undefined ? null : timestamp(options.startAt, 'startAt')
      const firstAt = timestamp(startAt ?? this.now() + options.intervalMs, 'first occurrence')
      return this.register(queue, data, options, { kind: 'interval', intervalMs: options.intervalMs, startAt }, policy(options.missed), firstAt)
    })
  }
  cron<T>(queue: Queue<T>, data: NoInfer<T>, options: CronOptions): Promise<ScheduleInfo> {
    return this.accept(() => {
      let cron: CronExpression
      try { cron = new CronExpression(options.expression) } catch { throw new ScheduleInputError('Invalid UTC cron expression') }
      const startAt = options.startAt === undefined ? null : timestamp(options.startAt, 'startAt')
      const firstAt = cron.next(startAt === null ? this.now() : startAt - 1)
      if (firstAt === undefined) throw new ScheduleInputError('Cron expression has no future occurrence')
      return this.register(queue, data, options, { kind: 'cron', expression: cron.expression, startAt }, policy(options.missed), firstAt)
    })
  }
  get(id: string): Promise<ScheduleInfo | undefined> {
    return this.accept(async () => { const row = await this.provider('get', () => this.store.get(id)); return row ? scheduleInfo(row) : undefined })
  }
  cancel(id: string): Promise<boolean> {
    return this.accept(() => {
      const now = this.now()
      return this.provider('cancel', () => this.store.cancel(id, now))
    })
  }
  tick(options: { readonly limit?: number } = {}): Promise<TickResult> {
    return this.accept(() => {
      const limit = options.limit ?? 100
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new ScheduleInputError('Invalid dispatch limit')
      const now = this.now()
      return this.provider('dispatch', () => this.store.dispatch({ now, limit }))
    })
  }
  close(): Promise<void> {
    this.closing ??= Promise.all([...this.active]).then(() => {})
    return this.closing
  }
}
