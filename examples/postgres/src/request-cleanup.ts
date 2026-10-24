import type { Database } from '@longhorn/database'
/** Reuses the existing request ledger and runtime grants; startup never grants or prunes. */
export async function checkRequestCleanupAccess(database:Database):Promise<void>{
  await database.execute('SELECT scope,request_key,expires_at FROM longhorn_idempotency.requests LIMIT 0')
  const permission=(await database.execute("SELECT (pg_catalog.has_table_privilege(current_user,'longhorn_idempotency.requests','SELECT') AND pg_catalog.has_table_privilege(current_user,'longhorn_idempotency.requests','DELETE')) AS allowed")).rows[0]
  if(permission?.allowed!==true)throw new Error('Request cleanup requires the existing ledger SELECT/DELETE grants')
}
