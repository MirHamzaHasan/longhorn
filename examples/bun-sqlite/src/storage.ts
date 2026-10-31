import { provide, token } from '@longhornjs/container'
import type { Database } from '@longhornjs/database'
import type { Longhorn } from '@longhornjs/core'
import { openSqlite } from '@longhornjs/bun/sqlite'
import { initializeTasksDatabase, SqliteTasksStore } from '../../basic/src/sqlite-tasks.js'
import { TasksStoreToken } from '../../basic/src/tasks.js'
import { configureTaskCache } from '../../basic/src/task-cache.js'
import type { TaskCacheResources } from '../../basic/src/task-cache.js'

export const TaskDatabase = token<Database>('Bun task database')

export function configureSqliteStorage(app: Longhorn, filename: string, cache: TaskCacheResources = {}): Longhorn {
  app.onStart(async () => {
    const database = await openSqlite({ filename })
    try {
      await initializeTasksDatabase(database)
      app.container.register(provide(TaskDatabase, { factory: () => database }))
      app.container.register(provide(TasksStoreToken, {
        deps: [TaskDatabase], factory: connection => new SqliteTasksStore(connection),
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
