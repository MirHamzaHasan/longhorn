# Retained schema and upgrades

Owner: `src/app.ts`, shared `authMigrations` and `@longhornjs/database` migration
execution. Startup composes the original auth tables with `auth_example/001_notes`.
The original SQL/checksums are retained; the note owner index already supplies
bounded ID-ordered reads. Account/session/attempt rows and notes survive restart.

Migrations are checksummed and transactional. Editing an already applied statement
causes startup to reject readiness; restore the original source and add an ordered
new migration for a real change. Do not bypass history checks or delete a retained
database to hide drift. Back up stopped SQLite state before deliberate upgrades.

The selected native driver enables foreign keys. File access and connection
ownership stay with [configuration](configuration.md) and [lifecycle](lifecycle.md),
not the auth store. Moving a file among verified Node/Bun/Deno hosts preserves
the schema and fixed password format; no PostgreSQL/D1 migration is implied.
