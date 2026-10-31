import { loadConfig } from '@longhornjs/config'
import { readEnv } from '@longhornjs/node/config'
import { openPostgres } from '@longhornjs/node/postgres'
import { PostgresAuthStore } from '@longhornjs/auth/postgres'
import { migrationConfigSchema } from './config.js'
import { operatorRole } from './operation-contracts.js'
const [action,username,...extra] = process.argv.slice(2)
if (!['grant','revoke'].includes(action??'') || !username || extra.length) { console.error('Usage: operator:postgres grant|revoke USERNAME'); process.exitCode=1 }
else {
  let database
  try {
    const config = await loadConfig(migrationConfigSchema,await readEnv({files:[new URL('../.env',import.meta.url),new URL('../.env.local',import.meta.url)],ignoreMissing:true}))
    database = await openPostgres({connectionString:config.MIGRATION_DATABASE_URL})
    const result = await new PostgresAuthStore(database).setUserRole(username,operatorRole,action==='grant')
    console.log(JSON.stringify(result));if(result.status==='missing')process.exitCode=1
  } catch { console.error('Operator role change failed; verify the account and provisioning credentials');process.exitCode=1 }
  finally { await database?.close() }
}
