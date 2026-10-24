# Search index deployment

Owner: examples/postgres/src/history-search-migrations.ts. The complete operations
profile appends postgres_account_operations/004_history_search after the entire
existing history/password/filter profile. Previous IDs, SQL and checksums remain
unchanged. Connects [search](history-id-search.md), [upgrades](command-app-upgrades.md),
[owner deployment](operator-provisioning.md) and [proof](history-search-testing.md).

| Index | Definition and purpose |
| --- | --- |
| operator_commands_search_history | pg_catalog.lower(id) text_pattern_ops, history_id DESC; case-folded deployment-wide ID prefix access |
| operator_commands_owner_search_history | owner_id, pg_catalog.lower(id) text_pattern_ops, history_id DESC; admitted-owner equality followed by ID prefix access |

Both live in longhorn_pg_example on operator_commands. Existing owner/global
history and delivery/status indexes stay in place. The native 6,000-row fixture
explains actual repository queries with ANALYZE and BUFFERS: its owner and global
100-row prefix queries use the corresponding new indexes without forced planner
settings. This proves those distributions and query shapes, not every prefix,
limit or production latency. Matching IDs may still require history-order sorting;
common prefixes and unavailable metadata can visit many rows.

The owner applies regular CREATE INDEX statements in the existing migration
transaction, committing indexes and ledger together. These are not CONCURRENTLY
builds. Budget build time/storage and write blocking in the stopped-writer
maintenance procedure. Upgrade matching browser/API hosts together: old readers
keep v1/v2 behavior but do not understand searched v3 continuations.

Startup/readiness require both named indexes to be valid/ready on the expected
table. Runtime performs no DDL or repair, and existing metadata SELECT grants are
sufficient, including the lower(id) expression. Catalog checks verify index/table
readiness, not a complete definition checksum; the owner-controlled migration
history remains the deployment authority. No automatic down migration is provided.

Native processes hold index DDL before commit, observe peer invisibility, SIGKILL
that owner and prove rollback of indexes/ledger. Two later owners serialize to
exactly one appended migration while retaining prior checksums and business rows.
