import { loadConfig } from '@longhorn/config'
import { createLogger } from '@longhorn/logger'
import { nodeRuntime } from '@longhorn/node'
import { readEnv } from '@longhorn/node/config'
import { createScryptPasswordHasher } from '@longhorn/node/passwords'
import { openSqlite } from '@longhorn/node/sqlite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAuthApp } from './app.js'
import { configSchema } from './config.js'

const bootstrap = createLogger({ bindings: { app: 'auth-example' } })
try {
  const config = await loadConfig(configSchema, await readEnv({
    files: [new URL('../.env', import.meta.url), new URL('../.env.local', import.meta.url)], ignoreMissing: true,
  }))
  const logger = createLogger({ level: config.logLevel, bindings: { app: 'auth-example' } })
  const filename = config.databasePath === ':memory:' ? ':memory:' : resolve(fileURLToPath(new URL('..', import.meta.url)), config.databasePath)
  const app = createAuthApp(config, { logger, passwords: createScryptPasswordHasher(),
    openDatabase: () => openSqlite({ filename }) }).onStop(() => { logger.info('Application stopped') })
  const server = await app.listen(nodeRuntime, { hostname: config.hostname, port: config.port })
  logger.info('HTTP server listening', { url: server.url, origin: config.origin })
  let closing = false
  async function shutdown() {
    if (closing) return
    closing = true
    try { await app.close() } catch (error) { logger.error('Application shutdown failed', { error }); process.exitCode = 1 }
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
} catch (error) { bootstrap.error('Authentication example startup failed', { error }); process.exitCode = 1 }
