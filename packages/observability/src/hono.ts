import type { Context, MiddlewareHandler } from 'hono'
import { matchedRoutes } from 'hono/route'
import type { Meter } from './metrics.js'
import { formatTraceparent, parseTraceparent } from './tracing.js'
import type { Span, TraceProvider } from './tracing.js'
import type { Readiness } from './readiness.js'

export type TelemetryEnv = { Variables: { telemetrySpan: Span | undefined } }
export function requestSpan(context: Context): Span | undefined { return context.get('telemetrySpan') as Span | undefined }
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE'])
export function httpTelemetry(options: { meter: Meter; tracer?: TraceProvider; excludePaths?: readonly string[]; onError?: (error: unknown) => void }): {
  middleware: MiddlewareHandler; snapshot: () => { active: number; errors: number }
} {
  const requests = options.meter.counter({ name: 'longhorn_http_requests_total', help: 'Completed HTTP requests.', labelNames: ['method', 'route', 'status'] })
  const duration = options.meter.histogram({ name: 'longhorn_http_request_duration_seconds', help: 'HTTP handler duration in seconds.', labelNames: ['method', 'route'] })
  const active = options.meter.gauge({ name: 'longhorn_http_requests_active', help: 'HTTP handlers currently active.' })
  const excluded = new Set(options.excludePaths ?? [])
  let inFlight = 0, errors = 0
  const safe = (work: () => void) => { try { work() } catch (error) { errors++; try { options.onError?.(error) } catch { /* Diagnostics cannot fail application work. */ } } }
  return {
    snapshot: () => ({ active: inFlight, errors }),
    middleware: async (c, next) => {
      if (excluded.has(c.req.path)) { await next(); return }
      const method = methods.has(c.req.method) ? c.req.method : 'OTHER'
      const started = performance.now()
      let span: Span | undefined, failed = false
      inFlight++; safe(() => active.set(inFlight))
      safe(() => {
        if (!options.tracer) return
        const parent = parseTraceparent(c.req.header('traceparent'))
        span = options.tracer.startSpan(`HTTP ${method}`, { kind: 'server', attributes: { 'http.request.method': method }, ...(parent ? { parent } : {}) })
        c.set('telemetrySpan', span)
      })
      try { await next() } catch (error) { failed = true; throw error }
      finally {
        const elapsed = Math.max(0, performance.now() - started)
        const status = failed ? 500 : c.res.status
        const routes = matchedRoutes(c)
        const match = routes.filter((route) => route.method !== 'ALL').at(-1)
          ?? routes.filter((route) => !route.path.includes('*')).at(-1)
        const route = match && match.path.length <= 240 ? match.path : '_unmatched'
        inFlight--; safe(() => active.set(inFlight))
        safe(() => requests.add(1, { method, route, status: String(status) }))
        safe(() => duration.record(elapsed / 1000, { method, route }))
        if (span) {
          safe(() => span!.setName(`${method} ${route}`))
          safe(() => span!.setAttribute('http.route', route))
          safe(() => span!.setAttribute('http.response.status_code', status))
          safe(() => span!.setStatus(status >= 500 ? 'error' : 'ok'))
          safe(() => c.header('traceparent', formatTraceparent(span!.context)))
          safe(() => span!.end())
        }
      }
    },
  }
}
export function readinessHandler(readiness: Readiness): (c: Context) => Promise<Response> {
  return async (c) => { const report = await readiness.check(); c.header('Cache-Control', 'no-store'); return c.json(report, report.status === 'ready' ? 200 : 503) }
}
export function livenessHandler(live: () => boolean = () => true): (c: Context) => Response {
  return (c) => { let healthy = false; try { healthy = live() } catch { /* No exception details in probes. */ }
    c.header('Cache-Control', 'no-store'); return c.json({ status: healthy ? 'alive' : 'not-alive' }, healthy ? 200 : 503) }
}
