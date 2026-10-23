import type { Database, SqlExecutor, SqlRow, SqlValue } from '@longhorn/database'
import type { JobInfo } from '@longhorn/queue'
import type { DeliveryListRequest, DeliveryPage, RetryFailedRequest, RetryFailedResult } from './index.js'

// Explicit projection: inspection/recovery never fetch stored payloads or lease tokens.
const columns = 'queue,id,state,attempts,max_attempts,available_at,created_at,updated_at,lease_until,last_failure'
function number(value: unknown): number {
  const result = typeof value === 'bigint' ? Number(value) : value
  if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 0) throw new Error('Invalid outbox metadata integer')
  return result
}
function text(value: unknown): string { if (typeof value !== 'string') throw new Error('Invalid outbox metadata text'); return value }
function info(row: SqlRow): JobInfo {
  const state = text(row.state), failure = row.last_failure === null ? null : text(row.last_failure)
  if (!['pending','running','succeeded','failed'].includes(state) || (failure !== null && !['handler','invalid-payload','lease-expired'].includes(failure))) throw new Error('Invalid outbox metadata state')
  return { queue: text(row.queue), id: text(row.id), state: state as JobInfo['state'], attempts: number(row.attempts), maxAttempts: number(row.max_attempts),
    availableAt: number(row.available_at), createdAt: number(row.created_at), updatedAt: number(row.updated_at),
    leaseUntil: row.lease_until === null ? null : number(row.lease_until), lastFailure: failure as JobInfo['lastFailure'] }
}
export class SqlOutboxRecovery {
  private readonly table: string
  private readonly parameter: (index: number) => string
  constructor(private readonly database: Database, dialect: 'sqlite' | 'postgres') {
    this.table = dialect === 'postgres' ? 'longhorn_queue.jobs' : 'longhorn_queue_jobs'
    this.parameter = index => dialect === 'postgres' ? `$${index}` : '?'
  }
  async list(queue: string, request: DeliveryListRequest): Promise<DeliveryPage> {
    const p = this.parameter, args: SqlValue[] = [queue, request.state]
    if (request.after) args.push(request.after.createdAt, request.after.id)
    args.push(request.limit + 1)
    const rows = (await this.database.execute({ sql: `SELECT ${columns} FROM ${this.table}
      WHERE queue=${p(1)} AND state=${p(2)} ${request.after ? `AND (created_at,id)>(${p(3)},${p(4)})` : ''}
      ORDER BY created_at,id LIMIT ${p(args.length)}`, args })).rows
    const deliveries = rows.slice(0, request.limit).map(info), last = deliveries.at(-1)
    return { deliveries, nextCursor: rows.length > request.limit && last ? { queue, state: request.state, createdAt: last.createdAt, id: last.id } : null }
  }
  async retryFailed(queue: string, id: string, request: RetryFailedRequest): Promise<RetryFailedResult> {
    return this.retryFailedIn(this.database, queue, id, request)
  }
  /** Internal composition point; caller owns native transaction and any audit append. */
  async retryFailedIn(executor: SqlExecutor, queue: string, id: string, request: RetryFailedRequest): Promise<RetryFailedResult> {
    const p = this.parameter
    // Monotonic ceiling is the compare-and-set revision; attempts are never reset.
    const row = (await executor.execute({ sql: `UPDATE ${this.table} SET state='pending',max_attempts=max_attempts+${p(1)},
      available_at=${p(2)},updated_at=${p(3)},lease_token=NULL,lease_until=NULL
      WHERE queue=${p(4)} AND id=${p(5)} AND state='failed' AND max_attempts=${p(6)} AND max_attempts<=100-${p(7)} RETURNING ${columns}`,
      args: [request.additionalAttempts, request.availableAt, request.now, queue, id, request.expectedMaxAttempts, request.additionalAttempts] })).rows[0]
    if (row) return { status: 'scheduled', delivery: info(row) }
    const current = (await executor.execute({ sql: `SELECT ${columns} FROM ${this.table} WHERE queue=${p(1)} AND id=${p(2)}`, args: [queue, id] })).rows[0]
    if (!current) return { status: 'missing' }
    const delivery = info(current)
    return { status: delivery.state === 'failed' && delivery.maxAttempts === request.expectedMaxAttempts && delivery.maxAttempts + request.additionalAttempts > 100 ? 'budget-exhausted' : 'conflict', delivery }
  }
}
