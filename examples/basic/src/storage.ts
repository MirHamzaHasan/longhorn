import { provide, token } from '@longhorn/container'
import type { Database } from '@longhorn/database'
import type { Longhorn } from '@longhorn/core'
import { openSqlite } from '@longhorn/node/sqlite'
import { initializeTasksDatabase, SqliteTasksStore } from './sqlite-tasks.js'
import { TasksStoreToken } from './tasks.js'
import { configureTaskCache } from './task-cache.js'
import type { TaskCacheResources } from './task-cache.js'

export const TaskDatabase = token<Database>('tasks database')

export function configureSqliteStorage(app: Longhorn, filename: string, cache: TaskCacheResources = {}): Longhorn {
  app.onStart(async () => {
    const database = await openSqlite({ filename })
    try {
      await initializeTasksDatabase(database)
      app.container.register(provide(TaskDatabase, { factory: () => database }))
      app.container.register(provide(TasksStoreToken, {
        deps: [TaskDatabase], factory: (connection) => new SqliteTasksStore(connection),
      }))
      app.logger.info('Database ready')
      return () => database.close()
    } catch (error) {
      try { await database.close() } catch (closeError) {
        throw new AggregateError([error, closeError], 'Database startup and cleanup failed', { cause: error })
      }
      throw error
    }
  })
  return configureTaskCache(app, cache)
}
