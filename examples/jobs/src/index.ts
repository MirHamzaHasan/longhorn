import { loadConfig } from '@longhorn/config'
import { createLogger } from '@longhorn/logger'
import { nodeRuntime } from '@longhorn/node'
import { readEnv } from '@longhorn/node/config'
import { openSqlite } from '@longhorn/node/sqlite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJobsApp } from './app.js'
import { configSchema } from './config.js'
import { JobsDiagnostics } from './diagnostics.js'
import { createJobsLogging } from './logging.js'

const bootstrap = createLogger({ bindings: { app: 'jobs-example' } })
try {
  const config = await loadConfig(configSchema, await readEnv({
    files: [new URL('../.env', import.meta.url), new URL('../.env.local', import.meta.url)], ignoreMissing: true,
  }))
  const logging = createJobsLogging(config), logger = logging.logger
  const filename = config.databasePath === ':memory:' ? ':memory:' : resolve(fileURLToPath(new URL('..', import.meta.url)), config.databasePath)
  const app = createJobsApp(config, { logger, ...(logging.processor ? { logs: logging.processor } : {}), openDatabase: () => openSqlite({ filename }) })
    .onStop(() => { logger.info('Application stopped') })
  const server = await app.listen(nodeRuntime, { hostname: config.hostname, port: config.port })
  logger.info('HTTP server listening', { url: server.url })
  let closing = false
  async function shutdown() {
    if (closing) return
    closing = true
    app.container.resolve(JobsDiagnostics).beginDrain()
    logger.info('Application draining')
    if (config.shutdownGraceMs) await new Promise((resolve) => setTimeout(resolve, config.shutdownGraceMs))
    try { await app.close() } catch (error) { logger.error('Application shutdown failed', { error }); process.exitCode = 1 }
  }
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown)
} catch (error) { bootstrap.error('Jobs example startup failed', { error }); process.exitCode = 1 }
