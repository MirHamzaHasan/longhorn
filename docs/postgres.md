# Node PostgreSQL provider

Owner: `@longhornjs/node/postgres`. Connects the portable [database contract](database.md)
to node-postgres 8.23.1, [transactions](postgres-transactions.md),
[PostgreSQL migrations](postgres-migrations.md), and [the example](postgres-example.md).
Native sockets/TLS/pooling stay in this Node entrypoint. Core imports no driver.

```ts
const database = await openPostgres({
  connectionString: 'postgres://app:password@127.0.0.1:5432/example',
  maxConnections: 5, maxPending: 256,
})
const result = await database.execute({ sql: 'SELECT $1::bigint AS id', args: [9007199254740993n] })
await database.close()
```

SQL remains native PostgreSQL, with `$1`, `$2` parameters. There is no question-mark
rewriting, ORM, SQL builder, automatic schema translation or browser adapter. Each
execute accepts one statement, using the extended protocol even without arguments;
multiple-command scripts are rejected by PostgreSQL. Direct transaction-control
commands are rejected; use the owned callback [transaction API](postgres-transactions.md).
The executor/database expose `dialect: 'postgres'`. Existing SQLite stores/migrations
remain SQLite-specific. Legacy custom executors may omit dialect metadata.

The required TCP URL names host, user and database, with optional encoded password
and port (default 5432). Query/hash options are rejected; configure provider options
explicitly. URL components are passed to pg independently, including a password
callback, so PGUSER/PGPASSWORD/PGDATABASE/PGPORT/pgpass do not select credentials or
a database. Unix-socket URLs are not supported by this initial provider.

Localhost, 127.0.0.1 and ::1 default to non-TLS development connections. Other hosts
default to verified TLS. ssl=true enables verification; an ssl object can provide
ca/cert/key/servername, with rejectUnauthorized always true. Explicit ssl=false
disables TLS. URL sslmode is not used. Application roles, network deployment and
certificate provisioning belong to the host. Do not log credential URLs.

## Values and results

Arguments are string, finite number, bigint, boolean, null or Uint8Array. Bytes are
copied at admission and bigint binds as decimal text. Serialize JSON explicitly.
Result parsing is per pool, never a process-global pg parser mutation:

| PostgreSQL value | SqlValue output |
| --- | --- |
| int2/int4/oid, float4/float8 | JavaScript number |
| int8 | bigint |
| boolean | boolean |
| bytea | copied Uint8Array |
| exact numeric, JSON/JSONB, date/time/timestamps, arrays, UUIDs, other types | original text |
| SQL NULL | null |

Exact numeric/JSON integers and timestamp microseconds are not rounded through
JavaScript objects or Date. Use repository parsing/casts to produce application
DTOs. Floating-point nonfinite server values retain native number semantics; cast
to text when needed before JSON output. Alias duplicate column names (last duplicate
wins in named records). rowsAffected uses command rowCount, or zero for commands
without one. lastInsertId is undefined: request IDs with INSERT ... RETURNING.

## Pool and session lifetime

maxConnections defaults to 10 (1–100). maxPending defaults to 256 (1–100000) and
bounds all admitted operations, including connection waits; it separately bounds
queued statements per active transaction. Overflow rejects PostgresCapacityError.
Limits are per pool/process; sum them across hosts to fit server capacity. stats
reports total/idle/waiting clients, admitted active work, connection errors and close
state without credentials. Root operations can overlap across pooled connections.

Connection timeout defaults to 5000 ms (positive), idle pool timeout to 10000 ms,
statement timeout to 30000 ms, lock timeout to 5000 ms and idle transaction timeout
to 30000 ms. The latter timeouts allow explicit zero to disable. Values are bounded
by the signed 32-bit timer range. Server GUCs control statements/locks/idle callbacks;
pool waiting is not measured by statement_timeout. A JS callback with no active SQL
can still hold a connection until it returns or the server terminates it.

Each lease sets safe owned session settings (pg_catalog search_path, UTC time,
ISO dates, hex bytea and configured timeouts/application name). Applications should
schema-qualify their tables. On return, DISCARD ALL removes session settings, temp
tables, listeners, prepared statements and session locks. This adds setup/reset
round trips; group related work in a transaction to amortize them. Session state
does not persist across calls. See [PostgreSQL DISCARD](https://www.postgresql.org/docs/18/sql-discard.html).

Broken clients are destroyed. Idle and checked-out error listeners prevent orphan
client errors; optional onConnectionError is synchronous and best-effort. Individual
query errors stay on their original Promise. Startup verifies connectivity and
closes a failed pool. Close stops admission, drains accepted work, ends the pool
and memoizes a terminal promise. Cleanup/network failure can follow a committed
write; no automatic retries or exactly-once outcome are promised.

Verified against real PostgreSQL 18.4 on local macOS/ARM64. Poolers, failover,
replication, LISTEN/cursors, remote TLS endpoints and other runtimes are not verified
integrations. See [native verification and demo](postgres-local.md). The implementation
follows [node-postgres pooling](https://node-postgres.com/apis/pool) and uses its
documented [per-client transaction boundary](https://node-postgres.com/features/transactions).
