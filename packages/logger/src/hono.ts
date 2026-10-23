import type { MiddlewareHandler } from 'hono'
import type { Logger } from './index.js'

export type RequestLogEnv = { Variables: { logger: Logger; requestId: string } }

export function requestLogger(logger: Logger): MiddlewareHandler<RequestLogEnv> {
  return async (c, next) => {
    const requestId = crypto.randomUUID()
    const child = logger.child({ requestId, method: c.req.method, path: c.req.path })
    c.set('requestId', requestId)
    c.set('logger', child)
    const started = performance.now()
    await next()
    c.header('X-Request-Id', requestId)
    const status = c.res.status
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
    // Later middleware can enrich the request logger with trace IDs or other safe context.
    ;(c.get('logger') ?? child)[level]('HTTP request completed', { status, durationMs: Math.max(0, performance.now() - started) })
  }
}
