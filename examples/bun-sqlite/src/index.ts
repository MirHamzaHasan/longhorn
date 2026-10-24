import { bunRuntime } from '@longhorn/bun'
import { loadConfig } from '@longhorn/config'
import { createLogger } from '@longhorn/logger'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../../basic/src/app.js'
import { configSchema } from '../../basic/src/config.js'
import { configureSqliteStorage } from './storage.js'

// Same application/service/repository as Node; this host owns Bun's native file.
const bootstrap = createLogger({ bindings: { app: 'LongHorn', runtime: 'bun' } })
try {
  const config = await loadConfig(configSchema, Bun.env)
  const logger = createLogger({ level: config.logLevel, bindings: { app: config.appName, runtime: 'bun' } })
  const app = createApp(config, logger).runtime({ name: 'bun-tasks', adapter: 'bun' })
  const filename = config.databasePath === ':memory:' ? ':memory:'
    : resolve(fileURLToPath(new URL('..', import.meta.url)), config.databasePath)
  configureSqliteStorage(app, filename)
  app.onStop(() => { logger.info('Application stopped') })
  const server = await app.listen(bunRuntime, { hostname: config.hostname, port: config.port })
  logger.info('HTTP server listening', { url: server.url })

  let closing = false
  const shutdown = async () => {
    if (closing) return
    closing = true
    try { await app.close() } catch (error) {
      logger.error('Application shutdown failed', { error })
      process.exitCode = 1
    }
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
} catch (error) {
  bootstrap.error('Application startup failed', { error })
  process.exitCode = 1
}
