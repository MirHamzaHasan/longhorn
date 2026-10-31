import { loadConfig } from '@longhornjs/config'
import { createLogger } from '@longhornjs/logger'
import { readEnv } from '@longhornjs/node/config'
import { openPostgres } from '@longhornjs/node/postgres'
import { migratePostgres } from '@longhornjs/database/postgres'
import { migrationConfigSchema } from './config.js'
import { exampleSchema } from './tasks.js'
import { postgresExampleMigrations } from './migrations.js'
const logger = createLogger({ bindings: { app: 'postgres-migrations' } })
try {
  const config = await loadConfig(migrationConfigSchema, await readEnv({ files: [new URL('../.env', import.meta.url), new URL('../.env.local', import.meta.url)], ignoreMissing: true }))
  const database = await openPostgres({ connectionString: config.MIGRATION_DATABASE_URL, maxConnections: 1 })
  try { logger.info('PostgreSQL migrations applied', { added: await migratePostgres(database, postgresExampleMigrations, { schema: exampleSchema }) }) }
  finally { await database.close() }
} catch { logger.error('PostgreSQL migration failed; check owner configuration, privileges and migration history'); process.exitCode = 1 }
