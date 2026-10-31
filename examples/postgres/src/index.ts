import { loadConfig } from '@longhornjs/config'
import { createLogger } from '@longhornjs/logger'
import { readEnv } from '@longhornjs/node/config'
import { nodeRuntime } from '@longhornjs/node'
import { openPostgres } from '@longhornjs/node/postgres'
import { createScryptPasswordHasher } from '@longhornjs/node/passwords'
import { configSchema } from './config.js'
import { createPostgresApp } from './app.js'

const bootstrap = createLogger({ bindings: { app: 'postgres-example' } })
try {
  const config = await loadConfig(configSchema, await readEnv({ files: [new URL('../.env', import.meta.url), new URL('../.env.local', import.meta.url)], ignoreMissing: true }))
  const logger = createLogger({ level: config.logLevel, bindings: { app: 'postgres-example' } })
  const app = createPostgresApp({ logger,workerEnabled: config.workerEnabled,schedulerEnabled: config.schedulerEnabled,
    accounts: { origin: config.authOrigin,secure: config.secureCookies,sessionTtlMs: config.sessionTtlMs,passwords: createScryptPasswordHasher() },
    openDatabase: () => openPostgres({ connectionString: config.databaseUrl, maxConnections: config.maxConnections }) })
    .onStop(() => { logger.info('Application stopped') })
  const server = await app.listen(nodeRuntime, { hostname: config.hostname, port: config.port })
  logger.info('HTTP server listening', { url: server.url })
  let closing = false
  const shutdown = async () => { if (closing) return; closing = true; try { await app.close() } catch { logger.error('PostgreSQL shutdown failed'); process.exitCode = 1 } }
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown)
} catch { bootstrap.error('PostgreSQL startup failed; check database configuration, connectivity and applied migrations'); process.exitCode = 1 }
