# Account command attempt budget

Owners: examples/postgres/src/command-limits.ts, operator-config.ts and operations.ts.
Connects [request limits](request-limits.md), [accounts](account-operations.md),
[readiness](postgres-application-readiness.md), [preflight](operator-preflight.md),
[command template](command-project.md) and [backup](command-app-backup.md).

The optional operations.commandLimits {limit,windowMs,now?} registers PgCommandLimits
with a PostgresRateLimitStore and fixed scope account.commands.v1. It uses the
current authenticated account ID, shared across its sessions and app hosts.
Only POST /account/commands is limited. Global body size, exact-origin/cookie and
authentication guards run before consumption; JSON/schema validation and command
replay/business SQL run after it. Invalid JSON, conflicts and stable-key retries
therefore count. Reads, receipts, login, account settings, saved views and operator
recovery keep their existing behavior. Authentication's login throttle is separate.

The runtime profile defaults COMMAND_LIMIT_ENABLED=false. When enabled, defaults
are COMMAND_LIMIT_REQUESTS=60 and COMMAND_LIMIT_WINDOW_MS=60000. Bounds follow the
[package contract](request-limits.md). Misconfigured settings fail configuration
validation even if the capability is disabled. Keep host policies/clocks aligned;
a different policy for an unexpired bucket fails closed until that bucket expires.

A 429 creates no business, outgoing delivery or replay record. The budget commits
separately before business SQL and is not refunded on subsequent error. A retry
with the same command key after replenishment still reads its original replay;
rate limiting does not change atomic command/outbox/idempotency behavior.
Provider failure returns private 503 and a fixed-code warning, then readiness can
report missing access. Login/logout does not refill the account's budget.

Owner deployment appends package migration longhorn_rate_limit/001_buckets after
postgres_account_operations/005_history_views. All prior migration IDs/statements
remain unchanged. Runtime provisioning adds USAGE plus bucket SELECT/INSERT/UPDATE;
it does not grant DELETE. Excess bucket DELETE/schema CREATE fails operator role
checks. Startup, /readyz and preflight check new table/access only when opted in.
Disabled capability works against the previous complete operations profile.

The additive report v1 capability is commandLimitsEnabled. No preflight call
consumes a bucket. Archived and CLI-created apps ship the new source/package/guide.
Their full workflow enables a generous policy, verifies computed receipts, and
checks exact bucket state through offline backup/restore. Expired records reset
on use; maintenance is separate explicit [bounded pruning](rate-limit-sql.md).
See [native proof](rate-limit-testing.md) and the [starter guide](../starters/command-app/docs/request-limits.md).
