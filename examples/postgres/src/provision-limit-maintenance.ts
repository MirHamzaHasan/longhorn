import { openPostgres } from '@longhorn/node/postgres'
import { grantLimitMaintenance } from './limit-maintenance-grants.js'
import type { Database } from '@longhorn/database'
const [role, ...extra] = process.argv.slice(2)
let database: Database | undefined
try {
  if (!role || extra.length || !process.env.MIGRATION_DATABASE_URL) throw new Error('Missing role or deployment connection')
  database = await openPostgres({ connectionString: process.env.MIGRATION_DATABASE_URL })
  await grantLimitMaintenance(database, role)
  console.log('Limit maintenance grants applied to the separate restricted role')
} catch { console.error('Limit maintenance provisioning failed; verify the separate role, owner connection and deployed bucket schema'); process.exitCode = 1 }
finally { try { await database?.close() } catch { console.error('Limit maintenance provisioning could not close its database'); process.exitCode = 1 } }
