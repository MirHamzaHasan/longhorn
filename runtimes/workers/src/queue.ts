import type { Message, MessageBatch } from '@cloudflare/workers-types'
import type { ContextualFetchApplication, TaskApplication } from '@longhornjs/runtime'
import { createWorker } from './index.js'
import type { WorkerExecutionContext, WorkerHandler } from './index.js'

export type WorkerQueueMessage<Body = unknown> = Pick<Message<Body>, 'id' | 'timestamp' | 'body' | 'attempts' | 'ack' | 'retry'>
export type WorkerQueueBatch<Body = unknown> = Pick<MessageBatch<Body>, 'queue' | 'messages' | 'ackAll' | 'retryAll'>
export type QueueDecision = { readonly action: 'ack' } | { readonly action: 'retry'; readonly delaySeconds?: number }
export type QueueBatchInvocation<Bindings extends object> = {
  readonly batch: WorkerQueueBatch
  readonly bindings: Bindings
  readonly context: WorkerExecutionContext
  /** Cooperative budget; the batch retains ownership until actual work settles. */
  readonly signal: AbortSignal
}
export type QueueBatchSummary = { readonly attempted: number; readonly acked: number; readonly retried: number; readonly failed: number; readonly skipped: number }
export type QueueWorkerOptions<Bindings extends object> = {
  readonly handle: (invocation: QueueBatchInvocation<Bindings> & { readonly message: WorkerQueueMessage }) => QueueDecision | Promise<QueueDecision>
  readonly afterBatch?: (invocation: QueueBatchInvocation<Bindings> & { readonly summary: QueueBatchSummary }) => void | Promise<void>
  readonly maxConcurrentBatches?: number
  readonly messageConcurrency?: number
  readonly maxBatchSize?: number
  readonly timeoutMs?: number
}
export class QueueCapacityError extends Error { constructor() { super('Queue batch capacity exceeded'); this.name = 'QueueCapacityError' } }
export class QueueClosedError extends Error { constructor() { super('Queue adapter is closing or closed'); this.name = 'QueueClosedError' } }
export class QueueBatchInputError extends Error { constructor() { super('Invalid queue batch metadata'); this.name = 'QueueBatchInputError' } }
export class QueueDecisionError extends Error { constructor() { super('Invalid queue message decision'); this.name = 'QueueDecisionError' } }
export class QueueTimeoutError extends Error { constructor() { super('Queue batch budget exceeded'); this.name = 'QueueTimeoutError' } }
export class QueueBatchError extends AggregateError {
  constructor(errors: readonly unknown[]) { super(errors, 'Queue batch processing failed'); this.name = 'QueueBatchError' }
}
export type QueueWorker<Bindings extends object> = WorkerHandler<Bindings> & {
  queue(batch: WorkerQueueBatch, bindings: Bindings, context: WorkerExecutionContext): Promise<void>
  /** Stop queue admission and drain. Does not close Fetch or the application. */
  close(): Promise<void>
  stats(): { activeBatches: number; activeMessages: number; succeededBatches: number; failedBatches: number; rejectedBatches: number; acked: number; retried: number; failedMessages: number; skippedMessages: number; timedOut: number; closing: boolean; closed: boolean }
}
const integer = (value: number, maximum: number) => Number.isSafeInteger(value) && value >= 1 && value <= maximum
function snapshot(batch: WorkerQueueBatch, maximum: number): readonly WorkerQueueMessage[] {
  if (!batch || typeof batch.queue !== 'string' || !batch.queue || batch.queue.length > 256 || /[\x00-\x1f\x7f]/.test(batch.queue) ||
    typeof batch.ackAll !== 'function' || typeof batch.retryAll !== 'function' || !Array.isArray(batch.messages) || batch.messages.length > maximum) throw new QueueBatchInputError()
  const messages = batch.messages.slice(), ids = new Set<string>()
  for (const message of messages) {
    if (!message || typeof message.id !== 'string' || !message.id || message.id.length > 512 || /[\x00-\x1f\x7f]/.test(message.id) || ids.has(message.id) ||
      !(message.timestamp instanceof Date) || !Number.isSafeInteger(message.timestamp.getTime()) || message.timestamp.getTime() < 0 ||
      !Number.isSafeInteger(message.attempts) || message.attempts < 1 || typeof message.ack !== 'function' || typeof message.retry !== 'function') throw new QueueBatchInputError()
    ids.add(message.id)
  }
  return messages
}
function decide(message: WorkerQueueMessage, decision: QueueDecision): 'ack' | 'retry' {
  if (!decision || typeof decision !== 'object') throw new QueueDecisionError()
  if (decision.action === 'ack' && Object.keys(decision).every(key => key === 'action')) { message.ack(); return 'ack' }
  if (decision.action === 'retry' && Object.keys(decision).every(key => key === 'action' || key === 'delaySeconds')) {
    const delay = decision.delaySeconds
    if (delay !== undefined && (!Number.isSafeInteger(delay) || delay < 0 || delay > 86400)) throw new QueueDecisionError()
    message.retry(delay === undefined ? undefined : { delaySeconds: delay }); return 'retry'
  }
  throw new QueueDecisionError()
}

/** Platform broker consumer. No SQL queue leases, automatic retries, or default success acknowledgement. */
export function createQueueWorker<Bindings extends object>(
  application: ContextualFetchApplication<Bindings, WorkerExecutionContext> & TaskApplication,
  options: QueueWorkerOptions<Bindings>,
): QueueWorker<Bindings> {
  const maximum = options.maxConcurrentBatches ?? 1, concurrency = options.messageConcurrency ?? 4,
    batchSize = options.maxBatchSize ?? 100, timeout = options.timeoutMs ?? 30000,
    handle = options.handle, afterBatch = options.afterBatch
  if (!integer(maximum, 64)) throw new Error('Invalid queue maxConcurrentBatches')
  if (!integer(concurrency, 64)) throw new Error('Invalid queue messageConcurrency')
  if (!integer(batchSize, 100)) throw new Error('Invalid queue maxBatchSize')
  if (!integer(timeout, 900000)) throw new Error('Invalid queue timeoutMs')
  if (typeof handle !== 'function' || (afterBatch !== undefined && typeof afterBatch !== 'function')) throw new Error('Invalid queue handler')
  const active = new Set<Promise<void>>()
  let closing: Promise<void> | undefined, closed = false, activeMessages = 0, succeededBatches = 0, failedBatches = 0,
    rejectedBatches = 0, acked = 0, retried = 0, failedMessages = 0, skippedMessages = 0, timedOut = 0
  const reject = (context: WorkerExecutionContext, error: unknown): Promise<void> => {
    rejectedBatches++
    const result = Promise.reject<void>(error)
    try { context.waitUntil(result) } catch (registrationError) { void result.catch(() => {}); return Promise.reject(registrationError) }
    return result
  }
  return {
    ...createWorker(application),
    queue(batch, bindings, context) {
      if (closing) return reject(context, new QueueClosedError())
      if (active.size >= maximum) return reject(context, new QueueCapacityError())
      let messages: readonly WorkerQueueMessage[]
      try { messages = snapshot(batch, batchSize) } catch (error) { return reject(context, error) }
      const cancellation = new AbortController(), invocation = { batch, bindings, context, signal: cancellation.signal }
      const timer = setTimeout(() => { timedOut++; cancellation.abort(new QueueTimeoutError()) }, timeout)
      let registrationFailure: { error: unknown } | undefined
      const operation = Promise.resolve().then(() => {
        if (registrationFailure) throw registrationFailure.error
        return application.run(async () => {
          cancellation.signal.throwIfAborted()
          let next = 0, attempted = 0, batchAcked = 0, batchRetried = 0
          const failures = new Map<number, unknown>()
          await Promise.all(Array.from({ length: Math.min(concurrency, messages.length) }, async () => {
            while (!cancellation.signal.aborted && next < messages.length) {
              const index = next++, message = messages[index]!
              attempted++; activeMessages++
              try {
                const decision = await handle({ ...invocation, message })
                cancellation.signal.throwIfAborted()
                if (decide(message, decision) === 'ack') { acked++; batchAcked++ }
                else { retried++; batchRetried++ }
              } catch (error) { failures.set(index, error); failedMessages++ }
              finally { activeMessages-- }
            }
          }))
          const skipped = messages.length - attempted
          skippedMessages += skipped
          const errors = [...failures].sort(([a], [b]) => a-b).map(([, error]) => error)
          if (afterBatch) {
            try { await afterBatch({ ...invocation, summary: { attempted, acked: batchAcked, retried: batchRetried, failed: failures.size, skipped } }) }
            catch (error) { errors.push(error) }
          }
          if (cancellation.signal.aborted) errors.push(cancellation.signal.reason)
          if (errors.length) throw new QueueBatchError(errors)
        })
      }).then(() => { succeededBatches++ }, error => { failedBatches++; throw error }).finally(() => { clearTimeout(timer); active.delete(settled) })
      const settled = operation.then(() => {}, () => {})
      active.add(settled)
      try { context.waitUntil(operation) } catch (error) { registrationFailure = { error } }
      return operation
    },
    close() { closing ??= Promise.all([...active]).then(() => { closed = true }); return closing },
    stats: () => ({ activeBatches: active.size, activeMessages, succeededBatches, failedBatches, rejectedBatches, acked, retried, failedMessages, skippedMessages, timedOut, closing: closing !== undefined, closed }),
  }
}
