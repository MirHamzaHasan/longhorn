import type { Database } from '@longhorn/database'
import { Longhorn } from '@longhorn/core'
import { provide, token } from '@longhorn/container'
import { RateLimiter } from '@longhorn/ratelimit'
import { PostgresRateLimitStore } from '@longhorn/ratelimit/postgres'
import { RateLimitCleanup } from '@longhorn/ratelimit/cleanup'
import type { LimitMaintenanceConfig } from './limit-maintenance-config.js'
import { checkLimitMaintenanceAccess } from './limit-maintenance-access.js'

export type LimitMaintenanceMode = 'check' | 'once' | 'watch'
export type LimitMaintenanceReport = Readonly<{ schemaVersion: 1; mode: LimitMaintenanceMode; ok: boolean; cancelled: boolean; runs: number; removed: number; errors: number; observerErrors: number }>
const MaintenanceDatabase = token<Database>('separate bucket maintenance database')
const MaintenanceLimits = token<RateLimiter>('table-wide budget maintenance')
const waitForStop = (signal: AbortSignal): Promise<void> => new Promise(resolve => {
  if (signal.aborted) return resolve()
  const stop = () => { signal.removeEventListener('abort', stop); resolve() }
  signal.addEventListener('abort', stop, { once: true })
  if (signal.aborted) stop()
})

/** No HTTP listener, migrations, grants or command consumption. Owns accepted native work until close. */
export async function runLimitMaintenance(options: {
  mode: LimitMaintenanceMode; loadConfiguration: () => Promise<LimitMaintenanceConfig>;
  openDatabase: (config: LimitMaintenanceConfig) => Promise<Database>; signal?: AbortSignal;
  onReady?: () => void | Promise<void>; onError?: (error: unknown) => void | Promise<void>
}): Promise<LimitMaintenanceReport> {
  const input = { ...options }
  if (!['check', 'once', 'watch'].includes(input.mode) || (input.mode === 'watch' && !input.signal)) throw new Error('Invalid maintenance mode or missing stop signal')
  const app = new Longhorn()
  let cleanup: RateLimitCleanup | undefined, failed = false, runs = 0, removed = 0, errors = 0
  try {
    if (!input.signal?.aborted) {
      const config = { ...await input.loadConfiguration() }
      if (!input.signal?.aborted) {
        app.onStart(async () => {
          const database = await input.openDatabase(config)
          try { await checkLimitMaintenanceAccess(database) }
          catch (error) { await database.close(); throw error }
          app.container.register(provide(MaintenanceDatabase, { factory: () => database }))
          return () => database.close()
        })
        app.container.register(provide(MaintenanceLimits, { deps: [MaintenanceDatabase], factory: database => new RateLimiter({ scope: 'maintenance.buckets.v1', store: new PostgresRateLimitStore(database) }) }))
        app.onStart(() => { const limiter = app.container.resolve(MaintenanceLimits); return () => limiter.close() })
        if (input.mode === 'watch') app.onStart(() => {
          cleanup = new RateLimitCleanup(app.container.resolve(MaintenanceLimits), { limit: config.limit, intervalMs: config.intervalMs, ...(input.onError ? { onError: input.onError } : {}) })
          // close may already have been requested while native startup checks were pending.
          if (!input.signal?.aborted) cleanup.start()
          return () => cleanup!.close()
        })
        await app.run(async () => {
          if (input.signal?.aborted) return
          await input.onReady?.()
          if (input.signal?.aborted) return
          if (input.mode === 'once') {
            runs++
            try { removed = await app.container.resolve(MaintenanceLimits).prune(config.limit) }
            catch (error) { errors++; throw error }
          } else if (input.mode === 'watch') await waitForStop(input.signal!)
        })
      }
    }
  } catch { failed = true }
  finally { try { await app.close() } catch { failed = true } }
  const snapshot = cleanup?.snapshot(), cancelled = !!input.signal?.aborted
  return Object.freeze({ schemaVersion: 1, mode: input.mode, ok: !failed && !(snapshot?.errors ?? errors) && !(snapshot?.observerErrors ?? 0) && (input.mode === 'watch' || !cancelled),
    cancelled, runs: snapshot?.runs ?? runs, removed: snapshot?.removed ?? removed, errors: snapshot?.errors ?? errors, observerErrors: snapshot?.observerErrors ?? 0 })
}
