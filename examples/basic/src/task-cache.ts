import { Cache } from '@longhornjs/cache'
import type { CacheStore } from '@longhornjs/cache'
import { MemoryCacheStore } from '@longhornjs/cache/memory'
import { provide, token } from '@longhornjs/container'
import type { Longhorn } from '@longhornjs/core'
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
