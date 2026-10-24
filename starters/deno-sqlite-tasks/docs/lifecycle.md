# Lifecycle

The host opens/migrates SQLite, acquires summary caching, then attaches event
observers before listening. HTTP drains before cleanup; events close before cache
loads and the database. Failed startup/binding releases acquired resources. Native
signals call app.close and coalesce repeats. All business/observer work is awaited;
do not close the database while requests still use it. See [migrations](migrations.md),
[events](events.md), [cache](cache.md) and [runtime](runtime.md).

The development watcher stops new builds, waits for reload ownership, and awaits
the Deno host shutdown. A host startup failure stops development.
