import type { Idempotency } from './index.js'
import { PruneWorker } from '@longhornjs/runtime/prune-worker'
import type { PruneWorkerOptions, PruneWorkerSnapshot } from '@longhornjs/runtime/prune-worker'

export type IdempotencyCleanupOptions = PruneWorkerOptions
export type IdempotencyCleanupSnapshot = PruneWorkerSnapshot

/** Explicit request-ledger cleanup; borrows the existing request API and clock. */
export class IdempotencyCleanup extends PruneWorker {
  constructor(requests: Pick<Idempotency, 'prune'>, options: IdempotencyCleanupOptions = {}) {
    if (!requests || typeof requests.prune !== 'function') throw new Error('Idempotency cleanup requires a pruner')
    super(requests, options)
  }
}
