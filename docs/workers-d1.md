# Workers D1 provider

Owner: `createD1`, `D1BatchDatabase`, `D1Binding`, `D1Options` and `D1Error` from
`@longhornjs/workers/d1`. Connects a supplied native D1 database/session to the
portable [batch contract](batch-database.md). Core and shared repositories import
no Cloudflare types or native binding APIs.

```ts
import { createD1 } from '@longhornjs/workers/d1'

const database = createD1(env.DB, { maxPending: 6 })
const result = await database.execute({ sql: 'SELECT title FROM tasks WHERE id=?', args: [id] })
await database.close()
```

The handle borrows `prepare`/`batch`, captures their methods and performs no I/O
at construction. Both execute and batch use one native `binding.batch` call.
Cloudflare documents its [ordered atomic batch behavior](https://developers.cloudflare.com/d1/worker-api/d1-database/).
The adapter exposes no JavaScript callback transaction. Native root bindings and
`D1DatabaseSession` satisfy its structural type; session selection/bookmarks remain
caller-owned, with no local proof of managed replication or failover.

Inputs are fully validated and copied before native preparation. Bound values
support null, well-formed strings, finite numbers, safe bigint and copied
Uint8Array blobs. Booleans bind as 1/0. Unsafe integer numbers/bigints reject;
bind a canonical decimal string when SQLite integer affinity must preserve int64.
Use [native prepared placeholders](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)
for data; repository SQL remains trusted.

One SQL statement is accepted per entry, with an optional final semicolon and
comments. A conservative boundary scanner understands quotes, comments and
CREATE TRIGGER bodies with internal statements/CASE expressions. It rejects
multiple statements and manual BEGIN/COMMIT/ROLLBACK/savepoint controls. It is
not a full SQLite parser or a tenant authorization boundary.

Results normalize named rows, changes and copied Uint8Array blobs. Integer-valued
numbers outside JavaScript's safe range reject with precision; select
`CAST(column AS TEXT)` for exact int64. Safe nonzero last_row_id becomes bigint;
unsafe IDs are omitted. Native metadata can retain an earlier insert ID even
after SELECT, so use explicit RETURNING columns for the current row's identity.

Decoding/precision/size errors occur after the native batch returns. A write may
already be committed even though the returned promise rejects. There is no
automatic replay, compensating rollback or exactly-once HTTP guarantee. Native
tests explicitly verify an INSERT committed before an unsafe RETURNING result
was rejected. [Task cursors](d1-pagination.md) keep wide values as text throughout.

| Option | Default | Accepted range |
| --- | --- | --- |
| maxPending | 6 operations | 1–1024 |
| maxBatchStatements | 40 | 1–1000 |
| maxSqlBytes | 65536 per statement | 1–100000 |
| maxInputBytes | 1 MiB per operation | 1–16 MiB |
| maxResultRows | 1000 across the operation | 1–100000 |
| maxResultBytes | 1 MiB of normalized keys/values | 1–16 MiB |

At most 100 arguments and 100 result columns per statement/row are accepted.
Result bounds run after the native driver materializes rows; they do not cap wire
allocation, SQL work or platform CPU. Select bounded columns and use SQL LIMIT.
These application limits do not raise Cloudflare's separate
[platform limits](https://developers.cloudflare.com/d1/platform/limits/).

Admission is immediate per handle, without a waiting queue or retry. Capacity
remains occupied until the actual binding promise settles. No synthetic deadline
races an uncancellable D1 operation. Close stops admission, memoizes and drains
accepted operations; it never deletes or closes the platform database. Stats
expose pending/operation/statement/failure counts and close state. Errors expose
input, capacity, closed, storage, protocol, precision or result-limit codes without
raw causes, SQL or arguments. See [deployment](d1-deployment.md),
[the runnable app](d1-tasks.md) and [native evidence](d1-testing.md).
