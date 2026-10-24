# Configuration

serve.mjs reads process environment and validates before retained storage creation.
HOST defaults to 127.0.0.1, PORT to 3000 (0 selects an available port). D1_DATA_PATH
defaults to this project's data/d1; a supplied relative path resolves from the
host working directory. This host reads no .env files.

D1_MAX_PENDING defaults to 6 (1–64), and D1_REQUEST_RETENTION_MS defaults to
86400000 (1–2592000000). Both use the same compiled schema as the Worker, then
become explicit bindings. Restart after environment changes. See [runtime](runtime.md),
[database](database.md) and [request replay](idempotency.md).

Optional [task creation limits](request-limits.md) append the native batch bucket
schema to the complete deployment profile. The budget uses database time and counts
attempts before task validation/replay. A denied request creates no task/activity/
request record; closing drains accepted work before the borrowed D1 handle.
