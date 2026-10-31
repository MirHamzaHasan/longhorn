import type { Longhorn, LonghornEnv } from '@longhornjs/core'
import type { Database } from '@longhornjs/database'
import { provide, token } from '@longhornjs/container'
import type { Token } from '@longhornjs/container'
import { RateLimiter } from '@longhornjs/ratelimit'
import { SqliteRateLimitStore, rateLimitMigrations } from '@longhornjs/ratelimit/sqlite'
import { rateLimit } from '@longhornjs/ratelimit/hono'
import type { MiddlewareHandler } from 'hono'

export type ReportLimitOptions = { readonly limit?: number; readonly windowMs?: number; readonly now?: () => number }
export const ReportRequestLimits = token<RateLimiter>('Object report submission attempts')
export { rateLimitMigrations as reportLimitMigrations }

/** Both direct and scheduled submissions use the same server-selected Object budget. */
export function configureReportLimits(app: Longhorn, database: Token<Database>, options?: ReportLimitOptions): MiddlewareHandler<LonghornEnv> {
  if (!options) return async (_c, next) => { await next() }
  const policy = { ...options }
  app.container.register(provide(ReportRequestLimits, { deps: [database], factory: db => new RateLimiter({
    ...policy, scope: 'public.reports.submit.v1', store: new SqliteRateLimitStore(db),
  }) }))
  app.onStart(() => { const limiter = app.container.resolve(ReportRequestLimits); return () => limiter.close() })
  return async (c, next) => rateLimit<LonghornEnv>(c.get('container').resolve(ReportRequestLimits), () => 'application')(c, next)
}
