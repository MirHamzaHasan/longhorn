import { loadConfig } from '@longhorn/config'
import { createLogger } from '@longhorn/logger'
import { denoRuntime } from '@longhorn/deno'
import { createScryptPasswordHasher } from '@longhorn/deno/passwords'
import { openSqlite } from '@longhorn/deno/sqlite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAuthApp } from './app.js'
import { configSchema } from './config.js'

const bootstrap = createLogger({ bindings: { app: 'auth-example', runtime: 'deno' } })
try {
  const environment = Object.fromEntries(['HOST', 'PORT', 'AUTH_ORIGIN', 'AUTH_COOKIE_SECURE', 'SESSION_TTL_SECONDS', 'DATABASE_PATH', 'LOG_LEVEL'].map(key => [key, Deno.env.get(key)]))
  const config = await loadConfig(configSchema, environment)
  const logger = createLogger({ level: config.logLevel, bindings: { app: 'auth-example', runtime: 'deno' } })
  const filename = config.databasePath === ':memory:' ? ':memory:' : resolve(fileURLToPath(new URL('..', import.meta.url)), config.databasePath)
  const app = createAuthApp(config, { logger, passwords: createScryptPasswordHasher(), openDatabase: () => openSqlite({ filename }) })
    .onStop(() => { logger.info('Application stopped') })
  const server = await app.listen(denoRuntime, { hostname: config.hostname, port: config.port })
  logger.info('HTTP server listening', { url: server.url, origin: config.origin })
  let closing: Promise<void> | undefined
  const shutdown = () => closing ??= app.close().catch(error => { logger.error('Application shutdown failed', { error }); Deno.exitCode = 1 })
  Deno.addSignalListener('SIGINT', shutdown); Deno.addSignalListener('SIGTERM', shutdown)
} catch (error) { bootstrap.error('Authentication example startup failed', { error }); Deno.exitCode = 1 }
