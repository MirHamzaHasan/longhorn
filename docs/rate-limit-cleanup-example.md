# Maintained SQLite report API

Owner: [examples/maintained-limits](../examples/maintained-limits/src/app.ts).
Connects core/Hono, bearer capability verification, DI, config, managed SQLite,
[request limits](request-limits.md) and [cleanup](rate-limit-cleanup.md).

```sh
export API_TOKEN="$(node -p "require('node:crypto').randomBytes(24).toString('hex')")"
LIMIT_CLEANUP_ENABLED=true pnpm dev:maintained-limits
```

The default listener is 127.0.0.1:3029. In a shell with the same API_TOKEN:

```sh
curl -i http://127.0.0.1:3029/reports -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' -d '{"numbers":[2,4,6]}'
```

The real result is count 3, sum 12, min 2, max 6. GET /health identifies the running app
after startup. These synchronous calculations are not persisted; quota
rows are. No inspection/prune/reset endpoint is exposed. The stable configured
RATE_LIMIT_SUBJECT, rather than a token/header/body value, selects the shared
reports.submit.v1 budget. Rotating only the bearer token preserves that identity.
This is a single-capability example, not account/tenant authorization.

Body size (8 KiB) and bearer verification precede quota. Validation follows quota;
invalid/repeated submissions count, denial returns 429/Retry-After/no-store and
provider error returns a private 503 with a fixed warning. Reads and rejected
credentials do not consume attempts. Use a production ingress/transport policy
appropriate for bearer credentials; the default is local development.

The host reads process env plus optional example .env/.env.local using the existing
Node loader; process values win. API_TOKEN is required, 32..256 URL-safe characters.
HOST/PORT/LOG_LEVEL select normal listener/logging behavior. DATABASE_PATH defaults
to examples/maintained-limits/data/reports.sqlite, retained across restarts.
RATE_LIMIT_REQUESTS defaults 60 (1..1000000); RATE_LIMIT_WINDOW_MS defaults 60000
(1000..86400000); RATE_LIMIT_SUBJECT defaults service-client (1..128 URL-safe chars).

| Cleanup setting | Default | Accepted value |
| --- | --- | --- |
| LIMIT_CLEANUP_ENABLED | false | true or false |
| LIMIT_CLEANUP_LIMIT | 100 | decimal integer 1..10000 |
| LIMIT_CLEANUP_INTERVAL_MS | 60000 | decimal integer 1000..86400000 |

All values validate before database/listener acquisition, including disabled
cleanup settings. Enabled wiring resolves BucketCleanup after ReportLimits and
starts it as an owned startup resource. Disabled wiring registers no cleanup
provider or timer. Both modes deploy the unchanged limiter schema. Startup failure
and Ctrl+C drain cleanup -> limiter -> database after HTTP. Fixed warnings omit
provider details, paths, bearer tokens and subjects. See [native executable proof](rate-limit-cleanup-testing.md).
