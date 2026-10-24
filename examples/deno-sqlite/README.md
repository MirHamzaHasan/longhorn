# Deno SQLite tasks

Run `pnpm dev:deno-sqlite` from the workspace root and open
http://127.0.0.1:3017/health. This uses Deno's native SQLite connection and the
existing task app/repository, preserving tasks in data/longhorn.sqlite.

[Host/settings](../../docs/deno-sqlite-tasks.md),
[native provider](../../docs/deno-sqlite.md),
[bindings](../../docs/deno-sqlite-bindings.md),
[transaction ownership](../../docs/deno-sqlite-transactions.md) and
[verification](../../docs/deno-sqlite-testing.md) each have a feature guide.
`pnpm test:deno-sqlite` runs real Deno SQL/permissions/crash/HTTP and native
Node/Bun file interoperability checks. Independent Deno CLI task generation is
not included in this example milestone.
