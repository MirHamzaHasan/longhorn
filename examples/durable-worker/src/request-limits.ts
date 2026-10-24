import type { Longhorn, LonghornEnv } from '@longhorn/core'
import type { Database } from '@longhorn/database'
import { provide, token } from '@longhorn/container'
import type { Token } from '@longhorn/container'
import { RateLimiter } from '@longhorn/ratelimit'
import { SqliteRateLimitStore, rateLimitMigrations } from '@longhorn/ratelimit/sqlite'
import { rateLimit } from '@longhorn/ratelimit/hono'
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
