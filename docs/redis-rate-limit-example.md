# Protected shared report API

Owner: examples/redis-limits. Connects [configuration](configuration.md),
[DI](dependency-injection.md), [bearer verification](bearer-capabilities.md),
[server-timed limits](redis-rate-limits.md), [validation](validation.md),
[readiness](observability.md) and [lifecycle](redis-rate-limit-lifecycle.md).

From the root, run pnpm dev:redis-limits after configuring this example's private
.env/.env.local. Process environment wins over those files. API_TOKEN must be a
private 32..256 character base64url/hex credential. A stable RATE_LIMIT_SUBJECT
(default service-client) labels its server-side budget. The bearer credential is a
service capability, not an individual identity. The example verifies it before
mapping to the configured principal; request headers/IP/query/body cannot choose
that principal. Rotating the credential with the same labels preserves its window.

REDIS_URL/REDIS_NAMESPACE select the deployment; transport/CA/deadline options use
the existing Node adapter. Production requires verified rediss; local redis needs
explicit REDIS_ALLOW_INSECURE_LOOPBACK=true. Configure noeviction/persistence as
[documented](redis-rate-limit-deployment.md). RATE_LIMIT_REQUESTS defaults to 60
(1..1000000), RATE_LIMIT_WINDOW_MS to 60000 (1000..86400000), HOST to 127.0.0.1 and
PORT to 3028. Config errors fail before resource acquisition and emit fixed text.

POST /reports accepts strict JSON {numbers:[3,7]} and computes
{result:{count:2,sum:10}}. Input is 1..100 finite numbers in +/-1e12; global body cap
is 8192 bytes. Body size and bearer guards run before the budget. Authenticated
invalid JSON/schema attempts count; denial returns 429/Retry-After before computation.
Native storage errors return private 503 and a warning with only fixed code/store.
Responses use no-store. It has no saved report, replay, account or business database.

GET /livez reports process health. GET /readyz checks Redis PING without consuming
a quota. Startup also requires PONG. A passing PING proves connectivity, not SET
permissions, noeviction configuration, persistence, capacity or future availability.
A dead native channel stays failed: explicitly restart the host to open a new one.
No implicit healthy-memory fallback resets the shared budget.

Two real native hosts, token rotation, malformed input, outage and explicit restart
are exercised by pnpm test:redis-limits. See [native evidence](redis-rate-limit-testing.md)
and the [example README](../examples/redis-limits/README.md).
