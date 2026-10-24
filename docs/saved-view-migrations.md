# Saved-view schema and runtime grants

Owner: src/history-view-migrations.ts, operations-migrations.ts and runtime-grants.ts.
Connects [values](saved-view-values.md), [write coordination](saved-view-concurrency.md),
[deployment](command-app-deployment.md) and [native proof](saved-view-testing.md).

The complete account-operations profile appends
postgres_account_operations/005_history_views after the entire previously deployed
history ending in 004_history_search. No earlier statement/checksum is changed.
Owner deployment creates longhorn_pg_example.history_views in the normal migration
transaction/ledger. Startup/readiness checks read its required columns and require
SELECT/INSERT/UPDATE/DELETE; they do not migrate or repair it.

Rows contain owner_id/id/name/scope/state/q/revision/created_at/updated_at. A composite
primary key begins with owner_id; a unique owner_id/name key supports account-local
names and bounded ordered reads. Names use C collation. Checks bound IDs, scope,
state, canonical lowercase UUID prefixes, safe revisions/times and nondecreasing
updated time. Canonical name normalization also belongs to the application. The
20-view quota is enforced by transaction locking in the repository, not a table
row-count constraint; trusted direct SQL maintenance must preserve that policy.

Only the new table gains runtime CRUD. No auth-user UPDATE, schema DDL, queue
DELETE or recovery-audit maintenance authority is added. Apply the full owner
migration profile, then rerun the trusted runtime provisioner before starting the
new host. Existing installations need both steps. Native/app rollback does not
rewrite deployed history; follow the established stopped-host upgrade procedure.

Offline database backup already covers the full application schema. Restore must
include this new ledger/table and reapply the current runtime grants. The archive
gate checkpoints a real saved view, restores into a new database/storage path,
restarts and edits it through the shipped browser. Preference IDs remain scoped
to accounts rather than globally shared links. Disabled/deleted-account cleanup
and further retention policies remain separate application maintenance work.
