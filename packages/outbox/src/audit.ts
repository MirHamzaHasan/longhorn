import type { Database, SqlRow, SqlValue } from '@longhorn/database'
import type { AuditedRetryRequest, AuditedRetryResult, AuthorizedRetryRequest, TransactionAuthorizer, AuditHistoryRequest, AuditPruneRequest, RecoveryAudit, RecoveryAuditPage } from './index.js'
import { SqlOutboxRecovery } from './recovery.js'

const columns = 'id,queue,delivery_id,actor,reason,created_at,expected_max_attempts,additional_attempts,available_at,outcome,result_state,result_attempts,result_max_attempts,result_failure'
function number(value: unknown): number { const result = typeof value === 'bigint' ? Number(value) : value; if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 0) throw new Error('Invalid outbox audit integer'); return result }
function text(value: unknown): string { if (typeof value !== 'string') throw new Error('Invalid outbox audit text'); return value }
function audit(row: SqlRow): RecoveryAudit {
  const outcome = text(row.outcome), state = row.result_state === null ? null : text(row.result_state), failure = row.result_failure === null ? null : text(row.result_failure)
  if (!['scheduled','conflict','budget-exhausted','missing'].includes(outcome) || (state !== null && !['pending','running','succeeded','failed'].includes(state)) || (failure !== null && !['handler','invalid-payload','lease-expired'].includes(failure))) throw new Error('Invalid outbox audit state')
  if ((outcome === 'missing') !== (state === null)) throw new Error('Invalid outbox audit result')
  return { id: text(row.id), queue: text(row.queue), deliveryId: text(row.delivery_id), actor: text(row.actor), reason: text(row.reason),
    createdAt: number(row.created_at), expectedMaxAttempts: number(row.expected_max_attempts), additionalAttempts: number(row.additional_attempts), availableAt: number(row.available_at),
    outcome: outcome as RecoveryAudit['outcome'], result: state === null ? null : { state: state as NonNullable<RecoveryAudit['result']>['state'], attempts: number(row.result_attempts), maxAttempts: number(row.result_max_attempts), lastFailure: failure as NonNullable<RecoveryAudit['result']>['lastFailure'] } }
}
export class SqlOutboxAudit {
  private readonly table: string
  private readonly parameter: (index: number) => string
  constructor(private readonly database: Database, dialect: 'sqlite' | 'postgres', private readonly recovery: SqlOutboxRecovery) {
    this.table = dialect === 'postgres' ? 'longhorn_outbox.recovery_audit' : 'longhorn_outbox_recovery_audit'
    this.parameter = index => dialect === 'postgres' ? `$${index}` : '?'
  }
  async retryFailedAudited(queue: string, id: string, request: AuditedRetryRequest): Promise<AuditedRetryResult> {
    return this.retryFailedAuthorized(queue, id, request, async () => ({ actor: request.actor }))
  }
  async retryFailedAuthorized(queue: string, id: string, request: AuthorizedRetryRequest, authorize: TransactionAuthorizer): Promise<AuditedRetryResult> {
    return this.database.transaction(async tx => {
      const principal = await authorize(tx)
      const result = await this.recovery.retryFailedIn(tx, queue, id, request)
      const summary = result.status === 'missing' ? null : result.delivery
      const args: SqlValue[] = [request.id, queue, id, principal.actor, request.reason, request.now, request.expectedMaxAttempts, request.additionalAttempts,
        request.availableAt, result.status, summary?.state ?? null, summary?.attempts ?? null, summary?.maxAttempts ?? null, summary?.lastFailure ?? null]
      const row = (await tx.execute({ sql: `INSERT INTO ${this.table} (${columns}) VALUES (${args.map((_, index) => this.parameter(index+1)).join(',')}) RETURNING ${columns}`, args })).rows[0]
      if (!row) throw new Error('Outbox audit insert returned no record')
      return { result, audit: audit(row) }
    })
  }
  async history(queue: string, request: AuditHistoryRequest): Promise<RecoveryAuditPage> {
    const args: SqlValue[] = [queue], clauses = [`queue=${this.parameter(1)}`]
    if (request.deliveryId !== undefined) { args.push(request.deliveryId); clauses.push(`delivery_id=${this.parameter(args.length)}`) }
    if (request.after) { args.push(request.after.createdAt, request.after.id); clauses.push(`(created_at,id)>(${this.parameter(args.length-1)},${this.parameter(args.length)})`) }
    args.push(request.limit+1)
    const rows = (await this.database.execute({ sql: `SELECT ${columns} FROM ${this.table} WHERE ${clauses.join(' AND ')} ORDER BY created_at,id LIMIT ${this.parameter(args.length)}`, args })).rows
    const records = rows.slice(0, request.limit).map(audit), last = records.at(-1)
    return { records, nextCursor: rows.length > request.limit && last ? { queue, deliveryId: request.deliveryId ?? null, createdAt: last.createdAt, id: last.id } : null }
  }
  async prune(queue: string, request: AuditPruneRequest): Promise<number> {
    // Audit rows are append-only and independent of deliveries; concurrent deletes remain bounded.
    const p = this.parameter
    return (await this.database.execute({ sql: `DELETE FROM ${this.table} WHERE queue=${p(1)} AND id IN (
      SELECT id FROM ${this.table} WHERE queue=${p(2)} AND created_at<=${p(3)} ORDER BY created_at,id LIMIT ${p(4)})`,
      args: [queue, queue, request.before, request.limit] })).rowsAffected
  }
}
