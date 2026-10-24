# Schema history

src/sqlite-tasks.ts defines the ordered task manifest. Startup uses the shared
SQLite migration runner; checksums protect applied order/text and pending SQL/
history commit in one write transaction. Never edit an applied migration. A
history mismatch fails startup before listening. This local example's startup
identity owns schema authority; restricted deployment roles or cloud rollout need
a separate procedure. See [SQLite](sqlite.md) and [testing](testing.md).

The unchanged task table migration is followed by a completed/id index migration.
See [retained read upgrades](upgrades.md) for legacy history and response changes.
