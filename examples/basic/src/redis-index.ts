import { loadConfig } from '@longhorn/config'
import { createLogger } from '@longhorn/logger'
import { readEnv } from '@longhorn/node/config'
import { nodeRuntime } from '@longhorn/node'
import type { Longhorn } from '@longhorn/core'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { configureSqliteStorage } from './storage.js'
import { redisConfigSchema } from './redis-config.js'
import { openTaskRedisCache } from './redis-cache.js'

let app: Longhorn | undefined, requested = false, closing: Promise<void> | undefined
const bootstrap = createLogger({ bindings: { app: 'redis-tasks' } })
function shutdown() {
  requested = true
  return closing ??= Promise.allSettled([starting,app?.close() ?? Promise.resolve()]).then(([,stopped]) => { if (stopped.status === 'rejected') throw stopped.reason })
}
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { void shutdown().catch(() => { bootstrap.error('Redis tasks shutdown failed'); process.exitCode = 1 }) })
const starting = (async () => {
  const config = await loadConfig(redisConfigSchema, await readEnv({ files: [new URL('../.redis.env', import.meta.url),new URL('../.redis.env.local', import.meta.url)], ignoreMissing: true }))
  if (requested) return
  const logger = createLogger({ level: config.logLevel, bindings: { app: config.appName } })
  app = createApp(config, logger).onStop(() => { logger.info('Application stopped') })
  const filename = config.databasePath === ':memory:' ? ':memory:' : resolve(fileURLToPath(new URL('..', import.meta.url)), config.databasePath)
  configureSqliteStorage(app, filename, { openStore: () => openTaskRedisCache(config) })
  const server = await app.listen(nodeRuntime, { hostname: config.hostname, port: config.port })
  if (!requested) logger.info('HTTP server listening', { url: server.url, cache: 'redis' })
})()
try { await starting } catch { if (!requested) { bootstrap.error('Redis tasks startup failed; verify configuration, database and Redis access'); process.exitCode = 1 }; await shutdown() }
