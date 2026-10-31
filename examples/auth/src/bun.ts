import { loadConfig } from '@longhornjs/config'
import { createLogger } from '@longhornjs/logger'
import { bunRuntime } from '@longhornjs/bun'
import { createScryptPasswordHasher } from '@longhornjs/bun/passwords'
import { openSqlite } from '@longhornjs/bun/sqlite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAuthApp } from './app.js'
import { configSchema } from './config.js'

const bootstrap = createLogger({ bindings: { app: 'auth-example', runtime: 'bun' } })
try {
  const config = await loadConfig(configSchema, Bun.env)
  const logger = createLogger({ level: config.logLevel, bindings: { app: 'auth-example', runtime: 'bun' } })
  const filename = config.databasePath === ':memory:' ? ':memory:' : resolve(fileURLToPath(new URL('..', import.meta.url)), config.databasePath)
  const app = createAuthApp(config, { logger, passwords: createScryptPasswordHasher(), openDatabase: () => openSqlite({ filename }) })
    .onStop(() => { logger.info('Application stopped') })
  const server = await app.listen(bunRuntime, { hostname: config.hostname, port: config.port })
  logger.info('HTTP server listening', { url: server.url, origin: config.origin })
  let closing: Promise<void> | undefined
  const shutdown = () => closing ??= app.close().catch(error => { logger.error('Application shutdown failed', { error }); process.exitCode = 1 })
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown)
} catch (error) { bootstrap.error('Authentication example startup failed', { error }); process.exitCode = 1 }
