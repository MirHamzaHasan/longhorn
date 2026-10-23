import { Cache } from '@longhorn/cache'
import type { CacheStore } from '@longhorn/cache'
import { MemoryCacheStore } from '@longhorn/cache/memory'
import { provide, token } from '@longhorn/container'
import type { Longhorn } from '@longhorn/core'
import { AppSettings } from './config.js'
import { configureTaskEvents } from './task-events.js'
import type { TaskSummary } from './tasks.js'

export const TaskSummaryCache = token<Cache<TaskSummary>>('task summary cache')
export const TaskSummaryStore = token<CacheStore<TaskSummary>>('task summary cache store')

export function registerTaskCache(app: Longhorn): void {
  app.container.register(provide(TaskSummaryCache, {
    deps: [AppSettings, TaskSummaryStore] as const,
    factory: (config, store) => new Cache<TaskSummary>(store, { ttlMs: config.cacheTtlMs }),
  }))
}

const configured = new WeakSet<Longhorn>()
export type TaskCacheResources = { readonly openStore?: () => Promise<CacheStore<TaskSummary>> }
/** DB -> cache -> events acquisition gives events -> cache -> DB cleanup. */
export function configureTaskCache(app: Longhorn, resources: TaskCacheResources = {}): Longhorn {
  if (configured.has(app)) return app
  if (!resources.openStore) app.container.register(provide(TaskSummaryStore, { factory: () => new MemoryCacheStore<TaskSummary>({ maxEntries: 16 }) }))
  app.onStart(async () => {
    let cache: Cache<TaskSummary>
    if (resources.openStore) {
      const store = await resources.openStore()
      try {
        app.container.register(provide(TaskSummaryStore, { factory: () => store }))
        cache = app.container.resolve(TaskSummaryCache)
      } catch (error) {
        try { await store.close() } catch (closeError) { throw new AggregateError([error, closeError], 'Task cache startup and cleanup failed', { cause: error }) }
        throw error
      }
    } else cache = app.container.resolve(TaskSummaryCache)
    return () => cache.close()
  })
  configureTaskEvents(app)
  configured.add(app)
  return app
}
