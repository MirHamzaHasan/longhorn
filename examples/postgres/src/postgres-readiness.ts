import type { Database } from '@longhorn/database'
import { checkAccountTables } from './accounts.js'
import type { AccountOptions } from './accounts.js'
import { checkOperationTables } from './operations.js'
import type { AccountOperationsOptions } from './operations.js'

/** The same runtime-visible schema checks serve startup, readiness and preflight. */
export async function checkPostgresTables(database: Database, accounts?: Pick<AccountOptions,'passwordChanges'|'sessionControls'|'sessionInventory'>, operations?: Pick<AccountOperationsOptions,'requestCleanup'|'commandLimits'>): Promise<void> {
  if (database.dialect !== 'postgres') throw new Error('PostgreSQL example requires the PostgreSQL provider')
  await database.execute('SELECT id FROM longhorn_pg_example.tasks LIMIT 0')
  await database.execute('SELECT job_id FROM longhorn_pg_example.task_reports LIMIT 0')
  await database.execute('SELECT id FROM longhorn_queue.jobs LIMIT 0')
  await database.execute('SELECT id FROM longhorn_scheduler.schedules LIMIT 0')
  await database.execute('SELECT request_key FROM longhorn_idempotency.requests LIMIT 0')
  if (accounts) await checkAccountTables(database,accounts.passwordChanges,accounts.sessionControls,accounts.sessionInventory)
  if (operations) await checkOperationTables(database,!!operations.requestCleanup,!!operations.commandLimits)
}
