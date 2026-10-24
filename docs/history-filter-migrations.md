# History filter indexes and deployment

Owner: examples/postgres/src/history-filter-migrations.ts. The complete
postgresOperationsMigrations list appends postgres_account_operations/003_history_filters
after the entire existing operations/history/password profile. Earlier migration
IDs, SQL and checksums remain unchanged. Connects [owner deployment](operator-provisioning.md),
[upgrades](command-app-upgrades.md), [filter SQL](history-status-filters.md)
and [native proof](history-filter-testing.md).

| Index | Purpose |
| --- | --- |
| longhorn_pg_example.operator_commands_delivery_owner_history | Partial index on delivery_id, owner_id, history_id DESC where delivery_id IS NOT NULL; join matching deliveries to admitted command rows |
| longhorn_queue.command_history_state | Partial index on state, id where queue='outbox.command.numbers.v1'; find matching jobs in this application's fixed queue |

Existing global/owner history-position indexes remain in place. The native
3,000-row fixture explains the actual repository query with ANALYZE and BUFFERS:
its rare failed-state owner query uses both new indexes with the default planner.
This is measured evidence for that fixture, not a promise about every state,
distribution or PostgreSQL plan. Unavailable uses a left anti-join and can examine
many commands; pagination only limits the returned page.

Deploy with the existing schema owner and complete operations profile before
starting updated HTTP hosts. Both regular CREATE INDEX statements and the ledger
entry commit in the existing managed migration transaction. These are not
CONCURRENTLY builds; they block writes on their tables during construction. Use
the existing stopped-writer maintenance/checkpoint procedure and budget index
build time and storage. No automatic down migration or runtime repair is provided.

Runtime startup and readiness require both named indexes to belong to the expected
tables and be valid/ready according to pg_catalog.pg_index. Missing indexes fail
closed until an owner deploys or repairs the schema. This check verifies those
catalog properties, not a full definition checksum; the owner-controlled migration
ledger remains the deployment authority. No additional runtime grants or schema
writes are introduced. Existing restricted metadata column grants suffice.

Native processes hold the new DDL before commit, verify it is invisible to peers,
kill the owner, and prove rollback of indexes and ledger. Two later owners serialize
to one deployment while preserving every prior checksum and retained business row.
