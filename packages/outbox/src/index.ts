import type { SqlExecutor } from '@longhornjs/database'
import { Queue, QueueWorker } from '@longhornjs/queue'
import type { EnqueueOptions, JobContext, JobInfo, JobState, QueueOptions, RunOptions, RunResult, WorkerOptions } from '@longhornjs/queue'
import { enqueueInTransaction } from '@longhornjs/queue/transaction'
import type { TransactionalQueueStore } from '@longhornjs/queue/transaction'

export type OutboundMessage<T> = { readonly id: string; readonly topic: string; readonly data: T }
export type PublishContext = Pick<JobContext, 'attempt' | 'maxAttempts' | 'signal'>
/** Resolve only after remote acceptance. A rejected/ambiguous result can be retried with the same message ID. */
export interface MessagePublisher<T> { publish(message: OutboundMessage<T>, context: PublishContext): Promise<void> }
export type PruneRequest = { readonly before: number; readonly limit: number; readonly includeFailed: boolean }
export interface OutboxStore extends TransactionalQueueStore {
  prune(queue: string, request: PruneRequest): Promise<number>
}
export type DeliveryCursor = { readonly queue: string; readonly state: JobState; readonly createdAt: number; readonly id: string }
export type DeliveryListRequest = { readonly state: JobState; readonly limit: number; readonly after?: DeliveryCursor }
export type DeliveryPage = { readonly deliveries: readonly JobInfo[]; readonly nextCursor: DeliveryCursor | null }
export type RetryFailedRequest = { readonly expectedMaxAttempts: number; readonly additionalAttempts: number; readonly now: number; readonly availableAt: number }
export type RetryFailedResult = { readonly status: 'scheduled' | 'conflict' | 'budget-exhausted'; readonly delivery: JobInfo } | { readonly status: 'missing' }
/** Optional capability; older custom stores can still enqueue/dispatch/prune. */
export interface OutboxRecoveryStore extends OutboxStore {
  list(queue: string, request: DeliveryListRequest): Promise<DeliveryPage>
  retryFailed(queue: string, id: string, request: RetryFailedRequest): Promise<RetryFailedResult>
}
export type RecoveryAudit = {
  readonly id: string; readonly queue: string; readonly deliveryId: string; readonly actor: string; readonly reason: string
  readonly createdAt: number; readonly expectedMaxAttempts: number; readonly additionalAttempts: number; readonly availableAt: number
  readonly outcome: RetryFailedResult['status']
  readonly result: Pick<JobInfo, 'state' | 'attempts' | 'maxAttempts' | 'lastFailure'> | null
}
export type AuditedRetryRequest = RetryFailedRequest & { readonly id: string; readonly actor: string; readonly reason: string }
export type AuditedRetryResult = { readonly result: RetryFailedResult; readonly audit: RecoveryAudit }
export type RecoveryAuditCursor = { readonly queue: string; readonly deliveryId: string | null; readonly createdAt: number; readonly id: string }
export type AuditHistoryRequest = { readonly deliveryId?: string; readonly limit: number; readonly after?: RecoveryAuditCursor }
export type RecoveryAuditPage = { readonly records: readonly RecoveryAudit[]; readonly nextCursor: RecoveryAuditCursor | null }
export type AuditPruneRequest = { readonly before: number; readonly limit: number }
/** Audit is opt-in: state transition and append-only result must share the same native transaction. */
export interface OutboxAuditStore extends OutboxRecoveryStore {
  retryFailedAudited(queue: string, id: string, request: AuditedRetryRequest): Promise<AuditedRetryResult>
  auditHistory(queue: string, request: AuditHistoryRequest): Promise<RecoveryAuditPage>
  pruneAudit(queue: string, request: AuditPruneRequest): Promise<number>
}
export type TransactionAuthorizer = (transaction: SqlExecutor) => Promise<{ readonly actor: string }>
export type AuthorizedRetryRequest = Omit<AuditedRetryRequest, 'actor'>
export interface OutboxAuthorizedStore extends OutboxAuditStore {
  retryFailedAuthorized(queue: string, id: string, request: AuthorizedRetryRequest, authorize: TransactionAuthorizer): Promise<AuditedRetryResult>
}
export type RetryOptions = { readonly expectedMaxAttempts: number; readonly additionalAttempts?: number; readonly delayMs?: number }
export type OutboxOptions<T> = Omit<QueueOptions<T>, 'store'> & { readonly store: OutboxStore }
function integer(value: number, name: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid outbox ${name}`)
  return value
}
function identifier(value: string): void { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) throw new Error('Invalid outbox delivery ID') }
function retryOptions(id: string, request: RetryOptions) {
  identifier(id)
  return { expectedMaxAttempts: integer(request.expectedMaxAttempts, 'expectedMaxAttempts', 1, 100),
    additionalAttempts: integer(request.additionalAttempts ?? 3, 'additionalAttempts', 1, 100), delayMs: integer(request.delayMs ?? 0, 'retry delay', 0) }
}

/** Durable outgoing records backed by the existing queue engine. Publisher calls always occur outside business transactions. */
export class Outbox<T> {
  readonly name: string
  readonly queueName: string
  private readonly queue: Queue<T>
  private readonly store: OutboxStore
  private readonly clock: () => number
  private readonly active = new Set<Promise<void>>()
  private closing: Promise<void> | undefined
  constructor(options: OutboxOptions<T>) {
    if (!/^[A-Za-z0-9._-]{1,93}$/.test(options.name)) throw new Error('Invalid outbox name')
    if (typeof options.store.enqueueInTransaction !== 'function' || typeof options.store.prune !== 'function') throw new Error('Outbox requires a transactional store with bounded pruning')
    this.name = options.name; this.queueName = `outbox.${options.name}`; this.store = options.store; this.clock = options.now ?? Date.now
    this.queue = new Queue({ ...options, name: this.queueName })
  }
  enqueue(data: NoInfer<T>, options: EnqueueOptions = {}): Promise<JobInfo> { return this.queue.enqueue(data, options) }
  enqueueInTransaction(transaction: SqlExecutor, data: NoInfer<T>, options: EnqueueOptions = {}): Promise<JobInfo> {
    return enqueueInTransaction(this.queue, transaction, data, options)
  }
  get(id: string): Promise<JobInfo | undefined> { return this.queue.get(id) }
  list(request: { readonly state?: JobState; readonly limit?: number; readonly after?: DeliveryCursor } = {}): Promise<DeliveryPage> {
    let input: DeliveryListRequest
    try {
      const state = request.state ?? 'failed', limit = integer(request.limit ?? 50, 'list limit', 1, 100)
      if (!['pending','running','succeeded','failed'].includes(state)) throw new Error('Invalid outbox state')
      const after = request.after === undefined ? undefined : { ...request.after }
      if (after) {
        if (after.queue !== this.queueName || after.state !== state || typeof after.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(after.id)) throw new Error('Invalid outbox cursor')
        integer(after.createdAt, 'cursor time', 0)
      }
      input = { state, limit, ...(after ? { after } : {}) }
    } catch (error) { return Promise.reject(error) }
    return this.maintenance(() => {
      const store = this.store as Partial<OutboxRecoveryStore>
      if (typeof store.list !== 'function') throw new Error('Outbox store does not support inspection')
      return store.list(this.queueName, input)
    })
  }
  retryFailed(id: string, request: RetryOptions): Promise<RetryFailedResult> {
    let input: ReturnType<typeof retryOptions>
    try { input = retryOptions(id, request) } catch (error) { return Promise.reject(error) }
    return this.maintenance(() => {
      const store = this.store as Partial<OutboxRecoveryStore>
      if (typeof store.retryFailed !== 'function') throw new Error('Outbox store does not support deliberate retry')
      const now = integer(this.clock(), 'clock', 0), availableAt = integer(now + input.delayMs, 'retry timestamp', 0)
      return store.retryFailed(this.queueName, id, { expectedMaxAttempts: input.expectedMaxAttempts, additionalAttempts: input.additionalAttempts, now, availableAt })
    })
  }
  retryFailedAudited(id: string, request: RetryOptions & { readonly actor: string; readonly reason: string }): Promise<AuditedRetryResult> {
    let input: ReturnType<typeof retryOptions>, actor: string, reason: string
    try {
      input = retryOptions(id, request); actor = request.actor; reason = request.reason
      if (typeof actor !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(actor)) throw new Error('Invalid outbox audit actor')
      if (typeof reason !== 'string' || !/^[a-z][a-z0-9._-]{0,99}$/.test(reason)) throw new Error('Invalid outbox audit reason code')
    } catch (error) { return Promise.reject(error) }
    return this.maintenance(() => {
      const store = this.store as Partial<OutboxAuditStore>
      if (typeof store.retryFailedAudited !== 'function') throw new Error('Outbox store does not support audited retry')
      const now = integer(this.clock(), 'clock', 0), availableAt = integer(now + input.delayMs, 'retry timestamp', 0)
      return store.retryFailedAudited(this.queueName, id, { id: crypto.randomUUID(), actor, reason, expectedMaxAttempts: input.expectedMaxAttempts, additionalAttempts: input.additionalAttempts, now, availableAt })
    })
  }
  retryFailedAuthorized(id: string, request: RetryOptions & { readonly reason: string }, authorize: TransactionAuthorizer): Promise<AuditedRetryResult> {
    let input: ReturnType<typeof retryOptions>, reason: string
    try {
      input = retryOptions(id, request); reason = request.reason
      if (typeof reason !== 'string' || !/^[a-z][a-z0-9._-]{0,99}$/.test(reason)) throw new Error('Invalid outbox audit reason code')
      if (typeof authorize !== 'function') throw new Error('A transaction authorizer is required')
    } catch (error) { return Promise.reject(error) }
    return this.maintenance(() => {
      const store = this.store as Partial<OutboxAuthorizedStore>
      if (typeof store.retryFailedAuthorized !== 'function') throw new Error('Outbox store does not support transactional authorization')
      const now = integer(this.clock(), 'clock', 0), availableAt = integer(now+input.delayMs, 'retry timestamp', 0)
      return store.retryFailedAuthorized(this.queueName, id, { id: crypto.randomUUID(),reason,expectedMaxAttempts: input.expectedMaxAttempts,additionalAttempts: input.additionalAttempts,now,availableAt }, async tx => {
        const principal = await authorize(tx)
        if (!principal || typeof principal.actor !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(principal.actor)) throw new Error('Invalid outbox audit actor')
        return { actor: principal.actor }
      })
    })
  }
  auditHistory(request: { readonly deliveryId?: string; readonly limit?: number; readonly after?: RecoveryAuditCursor } = {}): Promise<RecoveryAuditPage> {
    let input: AuditHistoryRequest
    try {
      const deliveryId = request.deliveryId, limit = integer(request.limit ?? 50, 'audit limit', 1, 100)
      if (deliveryId !== undefined) identifier(deliveryId)
      const after = request.after === undefined ? undefined : { ...request.after }
      if (after) {
        if (after.queue !== this.queueName || after.deliveryId !== (deliveryId ?? null)) throw new Error('Invalid outbox audit cursor')
        identifier(after.id); integer(after.createdAt, 'audit cursor time', 0)
      }
      input = { limit, ...(deliveryId === undefined ? {} : { deliveryId }), ...(after ? { after } : {}) }
    } catch (error) { return Promise.reject(error) }
    return this.maintenance(() => {
      const store = this.store as Partial<OutboxAuditStore>
      if (typeof store.auditHistory !== 'function') throw new Error('Outbox store does not support audit history')
      return store.auditHistory(this.queueName, input)
    })
  }
  pruneAudit(request: { readonly before: number; readonly limit?: number }): Promise<number> {
    let input: AuditPruneRequest
    try { input = { before: integer(request.before, 'audit prune time', 0), limit: integer(request.limit ?? 100, 'audit prune limit', 1, 10_000) } }
    catch (error) { return Promise.reject(error) }
    return this.maintenance(() => {
      const store = this.store as Partial<OutboxAuditStore>
      if (typeof store.pruneAudit !== 'function') throw new Error('Outbox store does not support audit retention')
      return store.pruneAudit(this.queueName, input)
    })
  }
  private handler(publisher: MessagePublisher<T>) {
    if (typeof publisher?.publish !== 'function') throw new Error('Outbox requires a message publisher')
    return (data: T, context: JobContext) => publisher.publish(Object.freeze({ id: context.id, topic: this.name, data }),
      { attempt: context.attempt, maxAttempts: context.maxAttempts, signal: context.signal })
  }
  dispatchOnce(publisher: MessagePublisher<T>, options: RunOptions = {}): Promise<RunResult> {
    return this.queue.runOnce(this.handler(publisher), options)
  }
  /** Native hosts own start/close. Fetch platforms should call bounded dispatchOnce from app.run/alarm ownership. */
  createDispatcher(publisher: MessagePublisher<T>, options: WorkerOptions = {}): QueueWorker<T> {
    return new QueueWorker(this.queue, this.handler(publisher), options)
  }
  prune(request: { readonly before: number; readonly limit?: number; readonly includeFailed?: boolean }): Promise<number> {
    if (this.closing) return Promise.reject(new Error('Outbox is closing or closed'))
    let input: PruneRequest
    try { input = { before: integer(request.before, 'prune time', 0), limit: integer(request.limit ?? 100, 'prune limit', 1, 10_000), includeFailed: request.includeFailed ?? false }
      if (typeof input.includeFailed !== 'boolean') throw new Error('Invalid outbox includeFailed')
    } catch (error) { return Promise.reject(error) }
    return this.maintenance(() => this.store.prune(this.queueName, input))
  }
  private maintenance<R>(work: () => Promise<R>): Promise<R> {
    if (this.closing) return Promise.reject(new Error('Outbox is closing or closed'))
    const operation = Promise.resolve().then(work)
    const settled = operation.then(() => {}, () => {})
    this.active.add(settled); void settled.then(() => this.active.delete(settled))
    return operation
  }
  close(): Promise<void> {
    this.closing ??= Promise.all([this.queue.close(), ...this.active]).then(() => {})
    return this.closing
  }
}
