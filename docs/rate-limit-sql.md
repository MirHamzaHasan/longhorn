# Managed SQL request limits

Owners: SqliteRateLimitStore and PostgresRateLimitStore, exported from
@longhorn/ratelimit/sqlite and /postgres. Both borrow a matching managed Database;
[limiter close](rate-limit-lifecycle.md) never closes that database.

Deploy rateLimitMigrations (SQLite) or postgresRateLimitMigrations (PostgreSQL)
through the existing [migration runner](migrations.md). Migration ID is
longhorn_rate_limit/001_buckets. SQLite uses the STRICT longhorn_rate_limit_buckets
table; PostgreSQL uses longhorn_rate_limit.buckets with PUBLIC privileges revoked.
The primary key is (scope,subject_hash). A partial index over expiry/scope/hash
supports ordered expired-row maintenance. Counts/policies/expiry have native
bounds; expiry is an exact JavaScript integer represented by PostgreSQL bigint.

Each consume inserts or locks the bucket with an UPSERT before sampling the
limiter's clock exactly once. This native write ownership spans policy checks,
count increment/reset and commit. A private claim guards the count-zero/NULL-expiry
reservation: an externally committed incomplete bucket fails closed. That
intermediate state is never published by the framework. A failed clock, policy
conflict, query or commit rolls back and returns no decision. A successful decision
is published only after commit. Denials saturate at limit+1 without moving expiry.

PostgreSQL runtime requires schema USAGE and bucket SELECT/INSERT/UPDATE. Its
application [runtime role](command-request-limits.md) has no DELETE or schema CREATE.
These are trusted application credentials: UPDATE authority itself can modify a
counter. The role checks constrain accidental/excess authority; they do not defend
against a compromised holder of all runtime credentials.

RateLimiter.prune(limit=100) is explicit table-wide maintenance across all scopes,
removing only expired rows. A separate PostgreSQL maintenance identity needs
SELECT/DELETE and schema USAGE. Its single statement takes an ordered bounded
FOR UPDATE SKIP LOCKED prefix, then deletes those rows. SQLite atomically deletes
the ordered bounded key prefix under its native write transaction. Live windows
are preserved; no daemon, background timer, maintenance CLI or HTTP reset exists.

Keep shared clocks/policies aligned. SQLite write contention uses its existing
provider admission/transaction rules; PostgreSQL serializes only competing bucket
rows. D1 BatchDatabase is a different contract. See [native SQL/process-death
proof](rate-limit-testing.md) and the [command upgrade](command-request-limits.md).
