# Readiness and liveness

Owner: `@longhorn/observability` (`Readiness`) and `/hono` handlers. Connects
[lifecycle](lifecycle.md), [HTTP](http.md), and [example dependencies](jobs-observability.md).

```ts
const readiness = new Readiness({ timeoutMs: 500, maxChecks: 32 })
readiness.add('database', async ({ signal }) => {
  if (signal.aborted) return false
  await database.execute('SELECT 1')
  return true
})
readiness.start()
app.http.get('/readyz', readinessHandler(readiness))
app.http.get('/livez', livenessHandler(() => app.state !== 'failed'))
// Pre-stop, while the server can still answer probes:
readiness.beginDrain()
await readiness.close()
```

Configure checks before start; names are unique ASCII letters/digits/dot/underscore/
hyphen, 1–64 characters. maxChecks defaults to 32 (1–128); each response deadline
defaults to 500 ms, with per-check overrides from 1–60000 ms. start is single-use.
Before start, after drain begins and after close, readiness is not-ready without
starting dependency work. Serving with no configured checks reports ready; define
checks for the actual role/dependencies before treating that result as meaningful.

Checks run in parallel. Only an exact true passes; false, rejected/thrown operations
or other values fail. Reports expose check names, pass/fail/timeout/busy/cancelled
status and elapsed milliseconds. Exception text, stacks and provider details are
omitted. No historical success is cached after an operation settles.

Concurrent probes share one flight per check. A deadline responds timeout and
aborts that check's AbortSignal. If underlying work ignores the signal, later
probes report busy until it settles; they do not start more calls. This bounds
underlying dependency work to one operation per registered check. Client disconnects
do not cancel shared checks; the check deadline and lifecycle own cancellation.
The timeout limits response waiting, not execution of an arbitrary Promise/query.

beginDrain changes serving/starting to draining, aborts current signals, and
releases pending probe responses as cancelled. close is idempotent, begins drain,
and waits for all underlying operations before setting closed. A check that never
settles keeps close pending; callbacks should honor cancellation and providers need
their own I/O timeouts. Never await readiness.close inside a check that close waits
for. The app must close readiness before dependencies its checks use.

readinessHandler returns 200 for ready, 503 otherwise, with a JSON report and
Cache-Control: no-store. livenessHandler uses a separate boolean predicate; false
or an exception returns 503 with no details. Its default is true (the handler is
alive). It performs no dependency checks. A temporary dependency outage need not
make the process dead. snapshot reports lifecycle phase and underlying active count.

Jobs readiness checks SQL and each enabled worker/runner state. A producer-only
host with consumers deliberately disabled can be ready for its configured role.
The portable starter checks its initialized state only; add dependencies explicitly.
Unit/native tests cover failure/recovery, concurrent probes, deadlines, busy bounds,
cancellation, close ordering and liveness/readiness separation over real HTTP.

The PostgreSQL example now reuses [one application schema helper](postgres-application-readiness.md)
for startup/live readiness and an independent [operator preflight](operator-preflight.md).
The diagnostic owner creates no application services and awaits pool close.
