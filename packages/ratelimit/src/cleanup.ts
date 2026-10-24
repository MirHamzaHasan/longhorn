import type { RateLimiter } from './index.js'
import { PruneWorker } from '@longhorn/runtime/prune-worker'
import type { PruneWorkerOptions, PruneWorkerSnapshot } from '@longhorn/runtime/prune-worker'

export type RateLimitCleanupOptions = PruneWorkerOptions
export type RateLimitCleanupSnapshot = PruneWorkerSnapshot

/** Explicit bounded maintenance; borrows the limiter, its store and its clock. */
export class RateLimitCleanup extends PruneWorker {
  constructor(limiter: Pick<RateLimiter, 'prune'>, options: RateLimitCleanupOptions = {}) {
    if (!limiter || typeof limiter.prune !== 'function') throw new Error('Rate limit cleanup requires a pruner')
    super(limiter, options)
  }
}
