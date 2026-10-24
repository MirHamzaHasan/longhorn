import { denoRuntime } from '@longhorn/deno'
import { loadConfig } from '@longhorn/config'
import { createLogger } from '@longhorn/logger'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../../basic/src/app.js'
import { configSchema } from '../../basic/src/config.js'
import { configureSqliteStorage } from './storage.js'

const bootstrap = createLogger({ bindings: { app: 'LongHorn', runtime: 'deno' } })
try {
  const environment = Object.fromEntries(['APP_NAME', 'HOST', 'PORT', 'LOG_LEVEL', 'DATABASE_PATH', 'CACHE_TTL_MS'].map(key => [key, Deno.env.get(key)]))
  const config = await loadConfig(configSchema, { PORT: '3017' }, environment)
  const logger = createLogger({ level: config.logLevel, bindings: { app: config.appName, runtime: 'deno' } })
  const app = createApp(config, logger).runtime({ name: 'deno-tasks', adapter: 'deno' })
  const filename = config.databasePath === ':memory:' ? ':memory:'
    : resolve(fileURLToPath(new URL('..', import.meta.url)), config.databasePath)
  configureSqliteStorage(app, filename)
  app.onStop(() => { logger.info('Application stopped') })
  const server = await app.listen(denoRuntime, { hostname: config.hostname, port: config.port })
  logger.info('HTTP server listening', { url: server.url })
  let closing: Promise<void> | undefined
  const shutdown = () => closing ??= (async () => {
    try { await app.close() } catch (error) { logger.error('Application shutdown failed', { error }); Deno.exitCode = 1 }
  })()
  Deno.addSignalListener('SIGINT', shutdown); Deno.addSignalListener('SIGTERM', shutdown)
} catch (error) { bootstrap.error('Application startup failed', { error }); Deno.exitCode = 1 }
