# Persistent PostgreSQL tasks example

Owner: examples/postgres. Connects [the provider](postgres.md), [migrations](postgres-migrations.md),
[roles](postgres-roles.md), [cursor pages](postgres-pagination.md), [DI](dependency-injection.md),
[validation](validation.md), [lifecycle](lifecycle.md) and [observability](observability.md).

For a self-contained temporary native demo:

```sh
pnpm demo:postgres
curl -i http://127.0.0.1:3003/tasks -H 'Content-Type: application/json' -d '{"title":"Try PostgreSQL"}'
curl 'http://127.0.0.1:3003/tasks?limit=20'
```

Ctrl+C stops the HTTP host/native server and removes demo data. Use [a provisioned
database](postgres-local.md) for persistent development. Set DATABASE_URL for the
runtime role and MIGRATION_DATABASE_URL for deployment in examples/postgres/.env
or .env.local (process environment wins), then run pnpm migrate:postgres and
pnpm dev:postgres. Do not commit credentials. PG_MAX_CONNECTIONS defaults to 5
(1–100), HOST to 127.0.0.1, PORT to 3003 (0 chooses a free port), LOG_LEVEL to info.

The migration CLI applies postgresExampleMigrations through migratePostgres with
history in the fixed longhorn_pg_example namespace. The original task prefix is
preserved before appending queue/schedule/report resources. Tasks use bigint GENERATED ALWAYS AS IDENTITY,
boolean completion, title checks, timestamptz creation time and a composite cursor
index. Deploy/assign runtime grants separately. HTTP startup only verifies access
to required task/report/queue/schedule tables; it cannot create a missing schema with runtime credentials.

| Method/path | Behavior |
| --- | --- |
| POST /tasks | Trim/validate 1–200-character title; return 201 and Location |
| GET /tasks | Bounded cursor page with optional completed filter |
| GET /tasks/:id | Task or 404 |
| PATCH /tasks/:id | Set completed boolean or 404 |
| DELETE /tasks/:id | 204 if deleted, otherwise 404 |
| GET /livez | Application liveness |
| GET /readyz | Required table/connection readiness |
| GET /metrics | Bounded HTTP Prometheus metrics |

Bodies over 8192 bytes return 413; invalid input/positive-int64 IDs return 400.
Unknown fields are rejected on writes. Tasks expose id/title/completed/createdAt;
createdAt preserves PostgreSQL's UTC timestamp text including microseconds. Repository
row validation maps bigint IDs to strings before JSON. Normal responses are no-store.
SQL values are bound, including titles containing quote/SQL-looking content.

The app registers PgDatabase -> PostgresTasksStore -> HTTP. Startup opens/verifies
the pool, then starts readiness. Cleanup drains HTTP and underlying checks before
closing the pool; final tracing/metric cleanup follows. Request logs gain safe trace
IDs while preserving normal request logging policy. A startup/bind failure also
releases the connection. The host logs safe startup/migration failure summaries,
without echoing credential URLs. Native pool/provider errors are available to library
callers; the example's default HTTP error policy is the core 500 response.

This is a separate local application, not a switch that moves existing
SQLite tasks/auth/jobs into PostgreSQL. Data in a provisioned PostgreSQL server
survives HTTP process restarts. The native gate proves CRUD, concurrent processes,
paging, roles, migration CLI, restart and shutdown against the actual engine.

The same app now exposes [background task reports](postgres-reports.md), including
one-time/interval/UTC-cron report schedules. Its executable defaults WORKER_ENABLED
and SCHEDULER_ENABLED to true; disable them independently for producer-only hosts.
Worker/runner shutdown precedes queue/scheduler/pool release. See the report guide
for routes, idempotent SQL effects, grants and programmatic timer defaults.

[Accounts](postgres-accounts.md) optionally add credential/session routes and private
notes under /account. The executable enables native scrypt accounts; its Origin,
cookie security and TTL settings are separate from the public task/report API.
The complete owner history is exported from migrations.ts, preserving deployed
task/job prefixes before auth and private-note migrations.

[`POST /tasks/with-report`](task-report-transactions.md) atomically creates a task
and publishes its report job. The committed response includes `Location` for the
task and `Report-Location` for the follow-up. It uses the existing schema and
runtime grants; [transaction publishing](postgres-transaction-publishing.md)
explains the shared database ownership and rollback behavior.

Its optional [Idempotency-Key](idempotency-http.md) saves the original task/job
response with that transaction. Matching retries across hosts or restart replay
the result; changed input conflicts. The owner migration history appends dedicated
request storage, and startup/readiness require its table and runtime grants.
