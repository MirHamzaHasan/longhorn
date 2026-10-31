import { ConfigError, loadConfig } from '@longhornjs/config'
import { nodeRuntime } from '@longhornjs/node'
import { readEnv } from '@longhornjs/node/config'
import { createApp } from './app.js'
import { configSchema } from './config.js'
import { createLogger } from '@longhornjs/logger'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configureSqliteStorage } from './storage.js'

const bootstrapLogger = createLogger({ bindings: { app: 'LongHorn' } })

async function start() {
  const environment = await readEnv({
    files: [new URL('../.env', import.meta.url), new URL('../.env.local', import.meta.url)],
    ignoreMissing: true,
  })
  const config = await loadConfig(configSchema, environment)
  const logger = createLogger({ level: config.logLevel, bindings: { app: config.appName } })
  const app = createApp(config, logger)
    .onStart(() => { logger.info('Application starting') })
    .onStop(() => { logger.info('Application stopped') })
  const filename = config.databasePath === ':memory:' ? ':memory:'
    : resolve(fileURLToPath(new URL('..', import.meta.url)), config.databasePath)
  configureSqliteStorage(app, filename)
  const server = await app.listen(nodeRuntime, { hostname: config.hostname, port: config.port })

  logger.info('HTTP server listening', { url: server.url })

  let closing = false
  async function shutdown() {
    if (closing) return
    closing = true
    logger.info('Application shutdown requested')
    try {
      await app.close()
    } catch (error) {
      logger.error('Application shutdown failed', { error })
      process.exitCode = 1
    }
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

try {
  await start()
} catch (error) {
  bootstrapLogger.error(error instanceof ConfigError ? error.message : 'Application startup failed', { error })
  process.exitCode = 1
}
