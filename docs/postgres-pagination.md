# PostgreSQL task cursor pages

Owner: examples/postgres/src/tasks.ts (`PostgresTasksStore`). Connects
[HTTP validation](validation.md), [PostgreSQL parameters](postgres.md), and
[the tasks example](postgres-example.md).

GET /tasks accepts limit (default 20, 1–100), optional after (positive int64 ID),
and optional completed=true/false. It returns `{ tasks, nextCursor }`. The query
orders by bigint ID, uses id > cursor, and fetches limit + 1 rows to detect another
page. nextCursor is the last returned ID when more rows were seen, otherwise null.
IDs remain decimal strings in HTTP rather than imprecise JavaScript numbers.

The primary-key index supports the default ID traversal. A (completed,id) index
supports equality filtering plus the ordered cursor range. SQL fragments come only
from fixed predicates; all cursor/filter/limit values use numbered bound arguments.
There is no OFFSET scan, caller-provided ordering/identifier or total-count query.

Pages are observations under normal transaction isolation, not a snapshot across
HTTP requests. Inserts after the cursor may appear later; deleted rows disappear;
changing filters between pages changes the selected dataset. Concurrent updates can
affect membership. The cursor is an ID boundary, not a signed opaque token or an
authorization decision. A public example has no tenant ownership check.

Native app tests and separate HTTP processes verify first/next pages, no repeated
IDs on unchanged filters, boolean filtering, int64/limit validation and concurrent
writers. This feature uses equality-before-range indexing and keyset
pagination guidance; it makes no constant-time or benchmark claim.
