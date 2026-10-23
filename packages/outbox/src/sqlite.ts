import type { Database, Migration } from '@longhorn/database'
import { SqliteQueueStore } from '@longhorn/queue/sqlite'
import type { OutboxAuthorizedStore, AuthorizedRetryRequest, TransactionAuthorizer, PruneRequest, DeliveryListRequest, RetryFailedRequest, AuditedRetryRequest, AuditHistoryRequest, AuditPruneRequest } from './index.js'
import { SqlOutboxRecovery } from './recovery.js'
import { SqlOutboxAudit } from './audit.js'

/** Append after queueMigrations in the application's complete history. Records use the existing jobs table. */
export const outboxMigrations: readonly Migration[] = [{ id: 'longhorn_outbox/001_retention', statements: [
  "CREATE INDEX longhorn_outbox_terminal ON longhorn_queue_jobs(queue,updated_at,id) WHERE state IN ('succeeded','failed')",
] }]
/** Append after the application's complete deployed history; the base migration list stays immutable. */
export const outboxRecoveryMigrations: readonly Migration[] = [{ id: 'longhorn_outbox/002_inspection', statements: [
  'CREATE INDEX longhorn_outbox_inspection ON longhorn_queue_jobs(queue,state,created_at,id)',
] }]
export const outboxAuditMigrations: readonly Migration[] = [{ id: 'longhorn_outbox/003_audit', statements: [
  `CREATE TABLE longhorn_outbox_recovery_audit (
    queue TEXT NOT NULL, id TEXT NOT NULL, delivery_id TEXT NOT NULL CHECK(length(delivery_id) BETWEEN 1 AND 200),
    actor TEXT NOT NULL CHECK(length(actor) BETWEEN 1 AND 200), reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 100),
    created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
    expected_max_attempts INTEGER NOT NULL CHECK(expected_max_attempts BETWEEN 1 AND 100),
    additional_attempts INTEGER NOT NULL CHECK(additional_attempts BETWEEN 1 AND 100),
    available_at INTEGER NOT NULL CHECK(available_at BETWEEN 0 AND 9007199254740991),
    outcome TEXT NOT NULL CHECK(outcome IN ('scheduled','conflict','budget-exhausted','missing')),
    result_state TEXT CHECK(result_state IN ('pending','running','succeeded','failed')),
    result_attempts INTEGER CHECK(result_attempts>=0), result_max_attempts INTEGER CHECK(result_max_attempts BETWEEN 1 AND 100 AND result_attempts<=result_max_attempts),
    result_failure TEXT CHECK(result_failure IN ('handler','invalid-payload','lease-expired')),
    PRIMARY KEY(queue,id),
    CHECK((outcome='missing' AND result_state IS NULL AND result_attempts IS NULL AND result_max_attempts IS NULL AND result_failure IS NULL)
      OR (outcome<>'missing' AND result_state IS NOT NULL AND result_attempts IS NOT NULL AND result_max_attempts IS NOT NULL)),
    CHECK(outcome<>'scheduled' OR (result_state='pending' AND result_max_attempts=expected_max_attempts+additional_attempts AND result_attempts<=expected_max_attempts))
  ) STRICT`,
  'CREATE INDEX longhorn_outbox_audit_history ON longhorn_outbox_recovery_audit(queue,created_at,id)',
  'CREATE INDEX longhorn_outbox_audit_delivery ON longhorn_outbox_recovery_audit(queue,delivery_id,created_at,id)',
] }]
export class SqliteOutboxStore extends SqliteQueueStore implements OutboxAuthorizedStore {
  private readonly recovery: SqlOutboxRecovery
  private readonly audits: SqlOutboxAudit
  constructor(private readonly connection: Database) {
    super(connection)
    if (connection.dialect !== 'sqlite') throw new Error('SQLite outbox requires a SQLite database')
    this.recovery = new SqlOutboxRecovery(connection, 'sqlite')
    this.audits = new SqlOutboxAudit(connection, 'sqlite', this.recovery)
  }
  list(queue: string, request: DeliveryListRequest) { return this.recovery.list(queue, request) }
  retryFailed(queue: string, id: string, request: RetryFailedRequest) { return this.recovery.retryFailed(queue, id, request) }
  retryFailedAudited(queue: string, id: string, request: AuditedRetryRequest) { return this.audits.retryFailedAudited(queue, id, request) }
  retryFailedAuthorized(queue: string, id: string, request: AuthorizedRetryRequest, authorize: TransactionAuthorizer) { return this.audits.retryFailedAuthorized(queue, id, request, authorize) }
  auditHistory(queue: string, request: AuditHistoryRequest) { return this.audits.history(queue, request) }
  pruneAudit(queue: string, request: AuditPruneRequest) { return this.audits.prune(queue, request) }
  async prune(queue: string, request: PruneRequest): Promise<number> {
    return (await this.connection.execute({ sql: `DELETE FROM longhorn_queue_jobs WHERE queue=? AND id IN (
      SELECT id FROM longhorn_queue_jobs WHERE queue=? AND state IN (${request.includeFailed ? "'succeeded','failed'" : "'succeeded'"})
      AND updated_at<=? ORDER BY updated_at,id LIMIT ?)`, args: [queue, queue, request.before, request.limit] })).rowsAffected
  }
}
