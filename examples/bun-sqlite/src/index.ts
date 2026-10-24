import { bunRuntime } from '@longhorn/bun'
import { openSqlite } from '@longhorn/bun/sqlite'
import { loadConfig } from '@longhorn/config'
import { provide, token } from '@longhorn/container'
import type { Database } from '@longhorn/database'
import { createLogger } from '@longhorn/logger'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../../basic/src/app.js'
import { configSchema } from '../../basic/src/config.js'
import { initializeTasksDatabase, SqliteTasksStore } from '../../basic/src/sqlite-tasks.js'
import { TasksStoreToken } from '../../basic/src/tasks.js'
import { configureTaskCache } from '../../basic/src/task-cache.js'

// Same application/service/repository as Node; this host owns Bun's native file.
const bootstrap = createLogger({ bindings: { app: 'LongHorn', runtime: 'bun' } })
try {
  const config = await loadConfig(configSchema, Bun.env)
  const logger = createLogger({ level: config.logLevel, bindings: { app: config.appName, runtime: 'bun' } })
  const app = createApp(config, logger).runtime({ name: 'bun-tasks', adapter: 'bun' })
  const TaskDatabase = token<Database>('Bun task database')
  const filename = config.databasePath === ':memory:' ? ':memory:'
    : resolve(fileURLToPath(new URL('..', import.meta.url)), config.databasePath)
  app.onStart(async () => {
    const database = await openSqlite({ filename })
    try {
      await initializeTasksDatabase(database)
      app.container.register(provide(TaskDatabase, { factory: () => database }))
      app.container.register(provide(TasksStoreToken, {
        deps: [TaskDatabase], factory: connection => new SqliteTasksStore(connection),
      }))
      logger.info('Database ready')
      return () => database.close()
    } catch (error) {
      try { await database.close() } catch (closeError) {
        throw new AggregateError([error, closeError], 'Database startup and cleanup failed', { cause: error })
      }
      throw error
    }
  })
  configureTaskCache(app)
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
