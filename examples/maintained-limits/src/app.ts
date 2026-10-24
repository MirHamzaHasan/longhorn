import { Longhorn } from '@longhorn/core'
import type { LonghornEnv } from '@longhorn/core'
import { provide, token } from '@longhorn/container'
import { createBearerVerifier } from '@longhorn/auth/bearer'
import type { Database } from '@longhorn/database'
import { migrate } from '@longhorn/database'
import type { Logger } from '@longhorn/logger'
import { RateLimiter } from '@longhorn/ratelimit'
import { SqliteRateLimitStore, rateLimitMigrations } from '@longhorn/ratelimit/sqlite'
import { RateLimitCleanup } from '@longhorn/ratelimit/cleanup'
import type { RateLimitCleanupOptions } from '@longhorn/ratelimit/cleanup'
import { rateLimit } from '@longhorn/ratelimit/hono'
import { validate } from '@longhorn/validation/hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'

export const LimitDatabase = token<Database>('report budget database')
export const ReportLimits = token<RateLimiter>('report submission budget')
export const BucketCleanup = token<RateLimitCleanup>('expired report bucket cleanup')
const input = z.object({ numbers: z.array(z.number().finite().min(-1e12).max(1e12)).min(1).max(100) }).strict()

export function createMaintainedLimitsApp(options: {
  openDatabase: () => Promise<Database>; apiToken: string; subject: string; limit: number; windowMs: number;
  cleanup?: RateLimitCleanupOptions; logger?: Logger
}): Longhorn {
  const config = { ...options }, cleanupOptions = config.cleanup ? { ...config.cleanup } : undefined
  const app = new Longhorn(config.logger ? { logger: config.logger } : {}), verify = createBearerVerifier(config.apiToken)
  app.onStart(async () => {
    const database = await config.openDatabase()
    try { await migrate(database, rateLimitMigrations) }
    catch (error) { await database.close(); throw error }
    app.container.register(provide(LimitDatabase, { factory: () => database }))
    return () => database.close()
  })
  app.container.register(provide(ReportLimits, { deps: [LimitDatabase], factory: database => new RateLimiter({
    scope: 'reports.submit.v1', limit: config.limit, windowMs: config.windowMs, store: new SqliteRateLimitStore(database),
  }) }))
  app.onStart(() => { const limiter = app.container.resolve(ReportLimits); return () => limiter.close() })
  if (cleanupOptions) {
    app.container.register(provide(BucketCleanup, { deps: [ReportLimits], factory: limiter => new RateLimitCleanup(limiter, cleanupOptions) }))
    app.onStart(() => { const cleanup = app.container.resolve(BucketCleanup); cleanup.start(); return () => cleanup.close() })
  }
  app.http.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  app.http.use('*', bodyLimit({ maxSize: 8192, onError: c => c.json({ error: 'Request body too large' }, 413) }))
  app.http.get('/health', c => c.json({ status: 'ok', storage: 'sqlite' }))
  app.http.post('/reports', async (c, next) => {
    if (!await verify(c.req.header('authorization'))) return c.json({ error: 'Authentication required' }, 401)
    await next()
  }, async (c, next) => rateLimit<LonghornEnv>(c.get('container').resolve(ReportLimits), () => config.subject, {
    onError: (_error, context) => { context.get('logger').warn('Report request limit unavailable') },
  })(c, next), validate('json', input), c => {
    const numbers = c.req.valid('json').numbers
    return c.json({ result: { count: numbers.length, sum: numbers.reduce((sum, value) => sum + value, 0), min: Math.min(...numbers), max: Math.max(...numbers) } })
  })
  return app
}
