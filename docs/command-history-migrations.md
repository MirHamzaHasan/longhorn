# Command history schema upgrade

Owner: postgresCommandHistoryMigrations in examples/postgres. Connects
[operations deployment](operator-provisioning.md), [PostgreSQL migrations](postgres-migrations.md)
and [history API](account-command-history.md).

The complete postgresOperationsMigrations profile now appends
postgres_account_operations/002_command_history after the unchanged 001_commands
prefix. postgresOperationsBaseMigrations exposes that exact older profile for
upgrade verification. Deploy with pnpm migrate:account-operations using the
existing owner role, then run the updated writer/host.

The upgrade adds history_id bigint identity, nullable created_at milliseconds and
nullable delivery_id to the existing command table. It adds unique global
history-position and owner/history indexes. New writes supply delivery ID/time
from the Outbox record in the same transaction. Runtime SELECT/INSERT grants
remain sufficient on the verified PostgreSQL engine; command UPDATE/DELETE stay
denied. Historical business rows and their public UUIDs are retained.

For old commands, the migration safely parses retained records from the one fixed
outgoing queue. It matches command ID and numbers; exactly one match supplies the
delivery ID/time. Pruned, ambiguous or malformed matches remain null. It never
guesses another delivery or treats unavailable status as success. JSON conversion
uses pg_input_is_valid before jsonb casting, including PostgreSQL JSON/numeric
representability checks. The native gate includes malformed text, invalid Unicode
and overflowing numeric input. See PostgreSQL's [validity functions](https://www.postgresql.org/docs/18/functions-info.html#FUNCTIONS-INFO-VALIDITY-TABLE)
and [JSON types](https://www.postgresql.org/docs/18/datatype-json.html).

Existing rows receive deterministic positions by known creation time, then ID;
unknown dates sort first. The column temporarily permits owner backfill during
this transaction, then becomes GENERATED ALWAYS. New positions remain int64 and
can contain gaps. These are insertion positions, not commit timestamps or a count
of commands. See [identity columns](https://www.postgresql.org/docs/18/ddl-identity-columns.html).

This is an owner-deployed transactional table/index rewrite with an exclusive
table lock, not an online migration protocol. Plan a maintenance window and
restart writers on the matching version. Older writers can still insert the
original columns but do not supply new delivery metadata. Native processes prove
before-commit SIGKILL rollback, subsequent concurrent upgrade serialization and
unchanged legacy migration checksums. Startup/readiness require the new columns.
