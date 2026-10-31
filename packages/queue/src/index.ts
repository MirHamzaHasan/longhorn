export const PACKAGE_NAME = '@longhornjs/queue'
export { Queue, QueueClosedError, QueueStoreError } from './queue.js'
export type { QueueOptions, EnqueueOptions, PreparedJob, RunOptions } from './queue.js'
export { QueueWorker } from './worker.js'
export type { WorkerOptions } from './worker.js'
export type { QueueStore, JobInfo, JobState, JobFailure, JobContext, JobHandler, RunResult,
  StoredJob, NewJob, Claim, Ownership, FailJob } from './types.js'
