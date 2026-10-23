import { parse } from '@longhorn/validation'
import type { StandardSchemaV1 } from '@longhorn/validation'
import { jobInfo } from './types.js'
import type { JobHandler, JobInfo, QueueStore, RunResult } from './types.js'
import type { NewJob, StoredJob } from './types.js'
import { registerPublisher } from './publishing.js'

export class QueueClosedError extends Error {
  constructor() { super('Queue is closing or closed'); this.name = 'QueueClosedError' }
}
export class QueueStoreError extends Error {
  constructor(readonly operation: keyof QueueStore, cause: unknown) {
    super(`Queue store ${operation} failed`, { cause }); this.name = 'QueueStoreError'
  }
}
export type QueueOptions<T> = {
  readonly name: string
  readonly store: QueueStore
  /** Must accept its own JSON output after a restart. Use stable, versioned queue names. */
  readonly schema: StandardSchemaV1<unknown, T>
  readonly leaseMs?: number
  readonly retryDelayMs?: number
  readonly maxRetryDelayMs?: number
  readonly maxPayloadBytes?: number
  readonly now?: () => number
}
export type EnqueueOptions = { readonly delayMs?: number; readonly maxAttempts?: number }
export type PreparedJob = { readonly queue: string; readonly payload: string; readonly maxAttempts: number }
export type RunOptions = { readonly heartbeat?: boolean }

function integer(value: number, name: string, min: number, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`)
  return value
}
function plus(now: number, offset: number) { return integer(now + offset, 'job timestamp', 0) }
function jsonValue(value: unknown, path = new Set<object>(), depth = 0): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object' || depth > 64 || path.has(value)) throw new Error('Job data must be finite, acyclic JSON with depth at most 64')
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new Error('Job data must use plain JSON objects')
  }
  path.add(value)
  try {
    if (Array.isArray(value)) {
      if (Reflect.ownKeys(value).length !== value.length + 1) throw new Error('Job arrays must be dense with no extra properties')
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index)
        if (!descriptor || !('value' in descriptor)) throw new Error('Job arrays must contain values')
        jsonValue(descriptor.value, path, depth + 1)
      }
    } else {
      for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!
        if (typeof key !== 'string' || !descriptor.enumerable || !('value' in descriptor)) throw new Error('Job objects must contain enumerable JSON values')
        jsonValue(descriptor.value, path, depth + 1)
      }
    }
  } finally { path.delete(value) }
}

/** One durable queue name, schema and handler contract. Does not own the store connection. */
export class Queue<T> {
  readonly name: string
  private readonly store: QueueStore
  private readonly schema: StandardSchemaV1<unknown, T>
  private readonly leaseMs: number
  private readonly retryDelayMs: number
  private readonly maxRetryDelayMs: number
  private readonly maxPayloadBytes: number
  private readonly clock: () => number
  private readonly active = new Set<Promise<void>>()
  private closing: Promise<void> | undefined

  constructor(options: QueueOptions<T>) {
    if (!/^[a-zA-Z0-9._-]{1,100}$/.test(options.name)) throw new Error('Invalid queue name')
    this.name = options.name; this.store = options.store; this.schema = options.schema
    this.leaseMs = integer(options.leaseMs ?? 30_000, 'leaseMs', 30)
    this.retryDelayMs = integer(options.retryDelayMs ?? 1000, 'retryDelayMs', 0)
    this.maxRetryDelayMs = integer(options.maxRetryDelayMs ?? 60_000, 'maxRetryDelayMs', this.retryDelayMs)
    this.maxPayloadBytes = integer(options.maxPayloadBytes ?? 65_536, 'maxPayloadBytes', 1)
    this.clock = options.now ?? Date.now
    registerPublisher(this, { store: this.store, enqueue: (data, options, write) => this.enqueueUsing(data as T, options, write) })
  }
  private now() { return integer(this.clock(), 'clock', 0) }
  private accept<R>(work: () => Promise<R>): Promise<R> {
    if (this.closing) return Promise.reject(new QueueClosedError())
    const operation = Promise.resolve().then(work)
    const settled = operation.then(() => {}, () => {})
    this.active.add(settled)
    void settled.then(() => this.active.delete(settled))
    return operation
  }
  private async provider<R>(operation: keyof QueueStore, work: () => Promise<R>): Promise<R> {
    try { return await work() } catch (cause) { throw new QueueStoreError(operation, cause) }
  }
  enqueue(data: NoInfer<T>, options: EnqueueOptions = {}): Promise<JobInfo> {
    return this.enqueueUsing(data, options, input => this.store.enqueue(input))
  }
  private enqueueUsing(data: T, options: EnqueueOptions, write: (job: NewJob) => Promise<StoredJob>): Promise<JobInfo> {
    return this.accept(async () => {
      const delay = integer(options.delayMs ?? 0, 'delayMs', 0)
      const prepared = await this.prepareValue(data, options)
      const now = this.now()
      const availableAt = plus(now, delay)
      const id = crypto.randomUUID()
      return jobInfo(await this.provider('enqueue', () => write({
        ...prepared, id, now, availableAt,
      })))
    })
  }
  /** Validate/snapshot for durable integrations without inserting a job. */
  prepare(data: NoInfer<T>, options: Pick<EnqueueOptions, 'maxAttempts'> = {}): Promise<PreparedJob> {
    return this.accept(() => this.prepareValue(data, options))
  }
  private async prepareValue(data: T, options: Pick<EnqueueOptions, 'maxAttempts'>): Promise<PreparedJob> {
    const maxAttempts = integer(options.maxAttempts ?? 3, 'maxAttempts', 1, 100)
    const parsed = await parse(this.schema, data)
    jsonValue(parsed)
    const payload = JSON.stringify(parsed)
    if (new TextEncoder().encode(payload).byteLength > this.maxPayloadBytes) throw new Error('Job payload exceeds maxPayloadBytes')
    return { queue: this.name, payload, maxAttempts }
  }
  get(id: string): Promise<JobInfo | undefined> {
    return this.accept(async () => {
      const row = await this.provider('get', () => this.store.get(this.name, id))
      return row ? jobInfo(row) : undefined
    })
  }
  runOnce(handler: JobHandler<T>, options: RunOptions = {}): Promise<RunResult> {
    const self = this
    return this.accept(async () => {
      const token = crypto.randomUUID()
      const now = this.now()
      plus(now, this.leaseMs)
      const job = await this.provider('claim', () => this.store.claim({ queue: this.name, token, now, leaseMs: this.leaseMs }))
      if (!job) return { status: 'idle' }
      const controller = new AbortController()
      const context = { id: job.id, queue: this.name, attempt: job.attempts, maxAttempts: job.maxAttempts, signal: controller.signal }
      let stopped = false, lost = false
      let heartbeatError: unknown, heartbeatFailed = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let renewing: Promise<void> = Promise.resolve()
      const ownership = () => ({ id: job.id, queue: this.name, token, now: this.now() })
      const schedule = () => {
        if (stopped || lost || options.heartbeat === false) return
        timer = setTimeout(() => {
          renewing = (async () => {
            try {
              const input = ownership(); plus(input.now, this.leaseMs)
              if (!await this.provider('renew', () => this.store.renew({ ...input, leaseMs: this.leaseMs }))) {
                lost = true; controller.abort(new Error('Job lease lost'))
              }
            } catch (error) { heartbeatError = error; heartbeatFailed = true; lost = true; controller.abort(error) }
            schedule()
          })()
        }, Math.min(2_147_483_647, Math.max(1, Math.floor(this.leaseMs / 3))))
      }
      schedule()
      let failure: 'handler' | 'invalid-payload' | undefined
      try {
        let data: T
        try {
          if (new TextEncoder().encode(job.payload).byteLength > this.maxPayloadBytes) throw new Error('Stored payload too large')
          data = await parse(this.schema, JSON.parse(job.payload))
        } catch { failure = 'invalid-payload'; return await finish() }
        if (!lost) {
          try { await handler(data, context) } catch { failure = 'handler' }
        }
        return await finish()
      } finally {
        stopped = true
        clearTimeout(timer)
        await renewing
      }
      // Stop and join any in-flight renewal before the final conditional transition.
      async function finish(): Promise<RunResult> {
        stopped = true; clearTimeout(timer); await renewing
        if (heartbeatFailed) throw heartbeatError
        if (lost) return { status: 'lost', id: job!.id }
        const input = ownership()
        if (!failure) {
          const completed = await self.provider('complete', () => self.store.complete(input))
          return { status: completed ? 'succeeded' : 'lost', id: job!.id }
        }
        const terminal = failure === 'invalid-payload' || job!.attempts >= job!.maxAttempts
        const delay = Math.min(self.maxRetryDelayMs, self.retryDelayMs * 2 ** (job!.attempts - 1))
        const retryAt = terminal ? null : plus(input.now, delay)
        const changed = await self.provider('fail', () => self.store.fail({ ...input, retryAt, reason: failure! }))
        return { status: changed ? terminal ? 'failed' : 'retrying' : 'lost', id: job!.id }
      }
    })
  }
  close(): Promise<void> {
    this.closing ??= Promise.all([...this.active]).then(() => {})
    return this.closing
  }
}
