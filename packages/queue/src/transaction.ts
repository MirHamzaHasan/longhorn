import type { SqlExecutor } from '@longhornjs/database'
import { participateInTransaction } from '@longhornjs/database/transactions'
import type { Queue, EnqueueOptions } from './queue.js'
import type { JobInfo, NewJob, QueueStore, StoredJob } from './types.js'
import { publisherFor } from './publishing.js'

/** SQL providers opt into the existing caller-owned transaction; they must verify its database identity. */
export interface TransactionalQueueStore extends QueueStore {
  enqueueInTransaction(transaction: SqlExecutor, job: NewJob): Promise<StoredJob>
}
/** Validation/insertion are joined before commit. An accepted failure poisons the transaction even if caught. */
export function enqueueInTransaction<T>(queue: Queue<T>, transaction: SqlExecutor, data: NoInfer<T>, options: EnqueueOptions = {}): Promise<JobInfo> {
  return participateInTransaction(transaction, executor => {
    const settings = { ...options }
    const publisher = publisherFor(queue), store = publisher.store as Partial<TransactionalQueueStore>
    if (typeof store.enqueueInTransaction !== 'function') throw new Error('Queue store does not support transaction publishing')
    return publisher.enqueue(data, settings, input => store.enqueueInTransaction!(executor, input))
  })
}
