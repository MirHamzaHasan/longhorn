# Verification

pnpm typecheck checks source with Bun declarations. pnpm test runs the copied task,
configuration, cache, events, lifetime and persistence tests under native bun:test.
The application remains editable. Runner/listener imports and the cache test's
type-only mock assertions are adapted from the original basic application; mocks
use Bun's actual test API and storage uses native bun:sqlite.

pnpm test:persistence builds then runs tests/persistence.mjs through pinned Bun.
It owns separate real HTTP hosts and temporary databases, verifies retained CRUD,
unique concurrent IDs, immutable schema history and SQLite integrity after restart.
It cleans up children and temporary files on failure. No cloud services are needed.

For manual review, create a task, restart pnpm start and read it again. During
pnpm dev, break syntax to keep the old host, then correct it and observe a drained
replacement with retained tasks. Activity/caches intentionally reset per host.
See [runtime](runtime.md), [configuration](configuration.md) and [SQLite](sqlite.md).
