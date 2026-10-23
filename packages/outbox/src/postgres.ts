import type { Database, Migration } from '@longhorn/database'
import { PostgresQueueStore } from '@longhorn/queue/postgres'
import type { OutboxAuthorizedStore, AuthorizedRetryRequest, TransactionAuthorizer, PruneRequest, DeliveryListRequest, RetryFailedRequest, AuditedRetryRequest, AuditHistoryRequest, AuditPruneRequest } from './index.js'
import { SqlOutboxRecovery } from './recovery.js'
import { SqlOutboxAudit } from './audit.js'

/** Append after postgresQueueMigrations. Runtime delivery needs no new DML; pruning requires maintenance DELETE. */
export const postgresOutboxMigrations: readonly Migration[] = [{ id: 'longhorn_outbox/001_retention', statements: [
  "CREATE INDEX outbox_terminal ON longhorn_queue.jobs(queue,updated_at,id) WHERE state IN ('succeeded','failed')",
] }]
/** Separate append-only feature list: preserve every deployed application migration prefix. */
export const postgresOutboxRecoveryMigrations: readonly Migration[] = [{ id: 'longhorn_outbox/002_inspection', statements: [
  'CREATE INDEX outbox_inspection ON longhorn_queue.jobs(queue,state,created_at,id)',
] }]
export const postgresOutboxAuditMigrations: readonly Migration[] = [{ id: 'longhorn_outbox/003_audit', statements: [
  'CREATE SCHEMA IF NOT EXISTS longhorn_outbox',
  'REVOKE ALL ON SCHEMA longhorn_outbox FROM PUBLIC',
  `CREATE TABLE longhorn_outbox.recovery_audit (
    queue text NOT NULL, id text NOT NULL, delivery_id text NOT NULL CHECK(length(delivery_id) BETWEEN 1 AND 200),
    actor text NOT NULL CHECK(length(actor) BETWEEN 1 AND 200), reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 100),
    created_at bigint NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
    expected_max_attempts integer NOT NULL CHECK(expected_max_attempts BETWEEN 1 AND 100),
    additional_attempts integer NOT NULL CHECK(additional_attempts BETWEEN 1 AND 100),
    available_at bigint NOT NULL CHECK(available_at BETWEEN 0 AND 9007199254740991),
    outcome text NOT NULL CHECK(outcome IN ('scheduled','conflict','budget-exhausted','missing')),
    result_state text CHECK(result_state IN ('pending','running','succeeded','failed')),
    result_attempts integer CHECK(result_attempts>=0), result_max_attempts integer CHECK(result_max_attempts BETWEEN 1 AND 100 AND result_attempts<=result_max_attempts),
    result_failure text CHECK(result_failure IN ('handler','invalid-payload','lease-expired')),
    PRIMARY KEY(queue,id),
    CHECK((outcome='missing' AND result_state IS NULL AND result_attempts IS NULL AND result_max_attempts IS NULL AND result_failure IS NULL)
      OR (outcome<>'missing' AND result_state IS NOT NULL AND result_attempts IS NOT NULL AND result_max_attempts IS NOT NULL)),
    CHECK(outcome<>'scheduled' OR (result_state='pending' AND result_max_attempts=expected_max_attempts+additional_attempts AND result_attempts<=expected_max_attempts))
  )`,
  'REVOKE ALL ON TABLE longhorn_outbox.recovery_audit FROM PUBLIC',
  'CREATE INDEX audit_history ON longhorn_outbox.recovery_audit(queue,created_at,id)',
  'CREATE INDEX audit_delivery ON longhorn_outbox.recovery_audit(queue,delivery_id,created_at,id)',
] }]
export class PostgresOutboxStore extends PostgresQueueStore implements OutboxAuthorizedStore {
  private readonly recovery: SqlOutboxRecovery
  private readonly audits: SqlOutboxAudit
  constructor(private readonly connection: Database) {
    super(connection)
    if (connection.dialect !== 'postgres') throw new Error('PostgreSQL outbox requires a PostgreSQL database')
    this.recovery = new SqlOutboxRecovery(connection, 'postgres')
    this.audits = new SqlOutboxAudit(connection, 'postgres', this.recovery)
  }
  list(queue: string, request: DeliveryListRequest) { return this.recovery.list(queue, request) }
  retryFailed(queue: string, id: string, request: RetryFailedRequest) { return this.recovery.retryFailed(queue, id, request) }
  retryFailedAudited(queue: string, id: string, request: AuditedRetryRequest) { return this.audits.retryFailedAudited(queue, id, request) }
  retryFailedAuthorized(queue: string, id: string, request: AuthorizedRetryRequest, authorize: TransactionAuthorizer) { return this.audits.retryFailedAuthorized(queue, id, request, authorize) }
  auditHistory(queue: string, request: AuditHistoryRequest) { return this.audits.history(queue, request) }
  pruneAudit(queue: string, request: AuditPruneRequest) { return this.audits.prune(queue, request) }
  async prune(queue: string, request: PruneRequest): Promise<number> {
    return (await this.connection.execute({ sql: `WITH terminal AS (
      SELECT queue,id FROM longhorn_queue.jobs WHERE queue=$1 AND state IN (${request.includeFailed ? "'succeeded','failed'" : "'succeeded'"})
      AND updated_at<=$2::bigint ORDER BY updated_at,id LIMIT $3 FOR UPDATE SKIP LOCKED
    ) DELETE FROM longhorn_queue.jobs AS jobs USING terminal WHERE jobs.queue=terminal.queue AND jobs.id=terminal.id`,
      args: [queue, request.before, request.limit] })).rowsAffected
  }
}
