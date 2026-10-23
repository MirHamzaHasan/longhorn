import { Queue } from './queue.js'
import type { JobHandler } from './types.js'
import type { StandardSchemaV1 } from '@longhorn/validation'
import { MemoryQueueStore } from './memory.js'
import { enqueueInTransaction } from './transaction.js'
import type { SqlExecutor } from '@longhorn/database'

declare const schema: StandardSchemaV1<unknown, { count: number }>
const queue = new Queue({ name: 'counts.v1', schema, store: new MemoryQueueStore() })
void queue.enqueue({ count: 1 })
// @ts-expect-error Payload follows the declared schema.
void queue.enqueue({ count: 'wrong' })
// @ts-expect-error Missing required payload member.
void queue.enqueue({})
declare const wrongHandler: JobHandler<{ count: string }>
// @ts-expect-error Handler data must match the durable queue schema.
void queue.runOnce(wrongHandler)
declare const transaction: SqlExecutor
void enqueueInTransaction(queue, transaction, { count: 1 })
// @ts-expect-error Transaction publishing retains the queue payload type.
void enqueueInTransaction(queue, transaction, { count: 'wrong' })
