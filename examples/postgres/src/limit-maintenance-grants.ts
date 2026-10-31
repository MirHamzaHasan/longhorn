import type { Database } from '@longhornjs/database'
import { checkLimitMaintenanceAccess } from './limit-maintenance-access.js'

/** Trusted deployment tool: grants one pre-existing role, never creates roles or repairs excess authority. */
export async function grantLimitMaintenance(database: Database, role: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role) || role.startsWith('pg_')) throw new Error('Invalid maintenance role')
  await database.transaction(async tx => {
    const target = '"' + role + '"'
    await tx.execute('GRANT USAGE ON SCHEMA longhorn_rate_limit TO ' + target)
    await tx.execute('GRANT SELECT,DELETE ON TABLE longhorn_rate_limit.buckets TO ' + target)
    await tx.execute('GRANT UPDATE(claim) ON TABLE longhorn_rate_limit.buckets TO ' + target)
    await checkLimitMaintenanceAccess(tx, role)
  })
}
