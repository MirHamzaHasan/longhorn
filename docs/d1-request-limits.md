# D1 task creation attempt budget

Owners: examples/d1-worker/src/request-limits.ts, app.ts, config.ts and index.ts.
Connects [batch storage](batch-rate-limits.md), [task requests](d1-idempotency-http.md),
[deployment](d1-limit-schema.md), [lifetime](d1-limit-lifecycle.md),
[CLI starter](d1-starter.md) and [verification](d1-limit-testing.md).

D1_CREATE_LIMIT_ENABLED defaults to false. Enabled defaults are
D1_CREATE_LIMIT_REQUESTS=60 (1..1000000) and D1_CREATE_LIMIT_WINDOW_MS=60000
(1000..86400000 ms). All settings are validated even when disabled. Worker bindings
and the local/generated host's environment use the same schema. Changed bindings
require a new Worker/host configuration generation, not per-request mutation of
an already cached app instance.

The existing public single-tenant demo uses scope public.tasks.create.v1 and
subject application for POST /tasks. Every enabled worker sharing that database
therefore shares one budget. Headers, forwarded IP, body and idempotency keys do
not choose identities. This is a public endpoint budget, not an account throttle.
Enable it consistently on all entrypoints that should enforce it; a deliberately
disabled host retains its ordinary unrestricted creation behavior.

The 16384-byte global body guard precedes consumption. JSON/schema validation,
request-key validation and replay/business SQL follow it. Invalid bodies/keys,
conflicts and stable-key retries count. GET, activity, PATCH and DELETE retain their
existing behavior. Denial returns 429 with no-store/Retry-After before any task,
activity or replay SQL. Storage or live-policy failure returns generic 503.

The attempt commits independently before business SQL, so an admitted request
whose activity write fails still consumes a slot. The business batch rolls back
normally. Expiry starts a fresh window; a stable-key retry then returns its original
saved response and creates no duplicate task. All enabled workers must agree on a
live policy, or the conflict fails closed until expiry. Server time and retained
state belong to the database, independent of JavaScript clock skew.

TaskCreateLimits is resolved at startup only when enabled and drains before
TaskDatabase. The complete migration history remains mandatory even when off;
startup performs no owner migration or repair. The installed starter includes the
actual source, config tests, schema, guide and native proof. See its
[guide](../starters/d1-tasks/docs/request-limits.md).
