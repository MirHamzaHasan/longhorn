import { Cache } from '@longhorn/cache'
import { MemoryCacheStore } from '@longhorn/cache/memory'
import { provide, token } from '@longhorn/container'
import type { Longhorn } from '@longhorn/core'
import { AppSettings } from './config.js'
import { configureTaskEvents } from './task-events.js'
import type { TaskSummary } from './tasks.js'

export const TaskSummaryCache = token<Cache<TaskSummary>>('task summary cache')

export function registerTaskCache(app: Longhorn): void {
  app.container.register(provide(TaskSummaryCache, {
    deps: [AppSettings] as const,
    factory: (config) => new Cache<TaskSummary>(new MemoryCacheStore<TaskSummary>({ maxEntries: 16 }), { ttlMs: config.cacheTtlMs }),
  }))
}

const configured = new WeakSet<Longhorn>()
/** DB -> cache -> events acquisition gives events -> cache -> DB cleanup. */
export function configureTaskCache(app: Longhorn): Longhorn {
  if (configured.has(app)) return app
  app.onStart(() => {
    const cache = app.container.resolve(TaskSummaryCache)
    return () => cache.close()
  })
  configureTaskEvents(app)
  configured.add(app)
  return app
}
