# Verification

pnpm test runs source schema/config checks. pnpm test:storage builds and runs
tests/storage.mjs against temporary real D1 storage. It verifies private schema,
cross-worker creation replay, revision conflicts, numeric pages and retained
task/activity/response across an actual workerd process restart. It never touches
this project's data/d1 or needs cloud credentials. Source edits should keep these
checks and expected migration IDs aligned. See [schema](schema.md),
[database](database.md) and [request replay](idempotency.md).
