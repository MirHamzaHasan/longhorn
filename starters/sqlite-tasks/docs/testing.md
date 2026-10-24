# Verification

pnpm test runs copied application tests: Fetch/DI/input, actual SQLite persistence/
HTTP concurrency, close, cache invalidation and event lifetime. Memory stores are
explicit test fixtures; the executable always opens its selected SQLite provider.

pnpm test:persistence builds and runs tests/persistence.mjs with owned temporary
files/hosts. It verifies separate-process restart, concurrent writers, updates/
deletion, nonreused IDs, migration history and PRAGMA integrity_check. It never
modifies this project's normal data directory. See [SQLite](sqlite.md),
[migrations](migrations.md), [events](events.md) and [cache](cache.md).
