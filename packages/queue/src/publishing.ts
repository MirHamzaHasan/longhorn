import type { EnqueueOptions } from './queue.js'
import type { JobInfo, NewJob, QueueStore, StoredJob } from './types.js'

type Publisher = { readonly store: QueueStore; enqueue(data: unknown, options: EnqueueOptions, write: (job: NewJob) => Promise<StoredJob>): Promise<JobInfo> }
const publishers = new WeakMap<object, Publisher>()
export function registerPublisher(queue: object, publisher: Publisher): void { publishers.set(queue, publisher) }
export function publisherFor(queue: object): Publisher {
  const publisher = publishers.get(queue)
  if (!publisher) throw new Error('A LongHorn queue instance is required')
  return publisher
}
