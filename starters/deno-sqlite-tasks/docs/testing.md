# Verification

pnpm typecheck checks source and the case-table adapter with Deno/Node declarations.
pnpm test bundles the actual six task/config/cache/event/lifetime/storage test files
with esbuild, then runs the resulting JavaScript in native Deno. node:test supplies
cases/hooks, while pinned expect and jest-mock supply real assertions and mocks.
tests/runner.ts expands shared it.each tables into native cases. Bundling resolves
TypeScript's .js import specifiers without an unstable Deno resolution flag. The
source remains editable; no assertion or store behavior is replaced by the adapter.

Tests grant filesystem access for owned temporary databases, loopback networking
for real HTTP and environment access for the test libraries. Those grants apply
to trusted tests; the normal host has the narrower configured permissions.

pnpm test:persistence builds and uses the pinned Deno executable for the SQL/HTTP
verification script. tests/processes.mjs uses Deno.Command and native process
status to join child shutdown and output readers. Each child gets the test's data
directory, loopback and named environment grants. The parent can execute only that
Deno binary; it owns temporary storage and joins child cleanup in finally.

The shipped persistence gate verifies retained CRUD, concurrent IDs, immutable
schema history, integrity, 1029-row cursor traversal, both filters, aggregate counts
and a deleted cursor boundary. Source tests pin the original migration checksum
and verify legacy upgrades and wide int64 cursors. No cloud service is required.

For manual review, create a task, restart pnpm start and read it again. In pnpm dev,
break syntax to retain the old host, then fix source for an ordered replacement
with retained tasks. Activity/caches reset per host. See [runtime](runtime.md),
[configuration](configuration.md), [SQLite](sqlite.md) and [upgrades](upgrades.md).
