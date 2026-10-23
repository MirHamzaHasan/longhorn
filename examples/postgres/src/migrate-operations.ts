import { loadConfig } from '@longhorn/config'
import { readEnv } from '@longhorn/node/config'
import { openPostgres } from '@longhorn/node/postgres'
import { migratePostgres } from '@longhorn/database/postgres'
import { migrationConfigSchema } from './config.js'
import { postgresOperationsMigrations } from './operations-migrations.js'
let database
try {
  const config=await loadConfig(migrationConfigSchema,await readEnv({files:[new URL('../.env',import.meta.url),new URL('../.env.local',import.meta.url)],ignoreMissing:true}))
  database=await openPostgres({connectionString:config.MIGRATION_DATABASE_URL})
  console.log(JSON.stringify({message:'Operations migrations applied',added:await migratePostgres(database,postgresOperationsMigrations,{schema:'longhorn_pg_example'})}))
}catch{console.error('Operations migration failed; verify owner configuration and deployed history');process.exitCode=1}
finally{await database?.close()}
