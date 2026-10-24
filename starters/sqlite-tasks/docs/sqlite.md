# Native SQLite storage

src/storage.ts acquires @longhorn/node/sqlite through startup and registers its
Database contract. src/sqlite-tasks.ts maps parameterized queries to Task values.
The provider uses file SQLite with foreign keys, WAL and full synchronization.
Integer columns retain bigint precision; the repository returns IDs as decimal
strings. Multiple local hosts can coordinate the same file. Database close drains
accepted work; native filesystem/storage behavior remains platform-specific.
See [schema](migrations.md), [tasks](tasks.md) and [testing](testing.md).
