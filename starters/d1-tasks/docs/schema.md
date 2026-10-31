# Schema deployment

src/schema.ts holds the complete ordered task/activity/request ledger manifest.
Never edit an applied migration. @longhornjs/database/batch verifies checksums and
guards the observed prefix before applying all missing SQL/history in one native
batch. Failed or competing stale upgrades roll back; rerun explicitly.

serve.mjs invokes src/deploy.ts through a private Miniflare service, removes that
worker, then checks readiness. Public application startup only verifies history/
columns; /deploy is not a public route. Coordinate retained schema/code versions;
an older shorter manifest rejects newer history. Cloud deployment needs a separate
owner-controlled private workflow. See [runtime](runtime.md) and [testing](testing.md).

Optional [task creation limits](request-limits.md) append the native batch bucket
schema to the complete deployment profile. The budget uses database time and counts
attempts before task validation/replay. A denied request creates no task/activity/
request record; closing drains accepted work before the borrowed D1 handle.
