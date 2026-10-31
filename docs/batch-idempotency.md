# Idempotent SQLite batch plans

Owner: `BatchIdempotency`, `BatchIdempotencyPlan` and `BatchIdempotencyError` from
`@longhornjs/idempotency/batch-sqlite`. Connects [atomic batch SQL](batch-database.md),
[strict JSON fingerprints](idempotency-json.md), [request records](batch-idempotency-storage.md)
and [D1 HTTP](d1-idempotency-http.md).

```ts
import { BatchIdempotency } from '@longhornjs/idempotency/batch-sqlite'

const requests = new BatchIdempotency({ database })
const id = crypto.randomUUID()
const outcome = await requests.run({
  scope: 'tenant:42:create-item:v1', key: clientKey, input: { title },
}, {
  statements: [{ sql: 'INSERT INTO items(id,title) VALUES(?,?)', args: [id,title] }],
  result: { id,title },
})
// outcome.value contains the original response, even if this call proposed another UUID.
```

The complete business plan and response are known before SQL. Generate IDs,
validate domain data and construct JSON first. Input, response, SQL and arguments/
blobs are snapshotted before asynchronous hashing. Exactly one native batch removes
an expired matching key, inserts its complete request record and executes business
statements. A duplicate unexpired key fails its INSERT before business SQL.
Native batch rollback keeps the ledger and business effects atomic.

After any batch failure, one read looks for positive committed evidence. Matching
eligible input returns saved JSON; changed input throws IdempotencyConflictError.
An own-generation record also recovers an acknowledgement or decoder failure after
commit, with replayed=false. Other generations return replayed=true. Missing/expired
records or an unavailable read return a sanitized storage error. No business batch
is automatically resubmitted.

This is separate from [callback Idempotency](idempotency.md). SELECT results cannot
be used in JavaScript to choose later statements or construct the response inside
the transaction. Use conditional SQL/constraints appropriate to a predeclared plan.
The caller owns the agreement between SQL effects and proposed JSON. Plans must
not alter the ledger, schema or transaction controls; SQL is trusted application
code. Database-generated response values need a different protocol.

Scope/key syntax and canonical fingerprints match the existing service. Derive
principal/tenant scopes server-side for private data and version them when input/
result meaning changes. Keys do not authorize access. Strict JSON rejects getters,
cycles, coercions and nonfinite values; domain schemas remain application-owned.

Defaults are 24-hour retention, 16 KiB input, 64 KiB result, 32 business statements
and 256 KiB of SQL/arguments. Retention accepts 1 ms–30 days; JSON limits 1 byte–1 MiB;
statement count 1–998; plan bytes 1–16 MiB. SQL is at most 65536 UTF-8 bytes per
statement with 100 arguments. Integer arguments must be safe JavaScript numbers/
bigints; use decimal strings for wider columns. Two owned statements are added;
provider/platform limits still apply.

The service borrows the database and owns no connection, timer or shutdown hook.
Await the complete operation through HTTP/app.run before closing the provider.
Input errors use IdempotencyInputError; other errors expose storage or record
codes without raw SQL/arguments/causes. Deploy [the ledger](batch-idempotency-storage.md)
separately and see [native proof](d1-idempotency-testing.md).
