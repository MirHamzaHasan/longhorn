# Retained task read upgrade

The original 001_create_tasks SQL remains unchanged, with statement-list checksum
9adcc799e7043fa9130be0208cdf4271c97a707d0453bd3b2ec5ac752328dcdf.
002_index_tasks_completed_id appends an index on tasks(completed,id). Startup
verifies existing history and applies pending DDL/history in one managed write
transaction before readiness. Existing tasks and IDs remain intact.

Do not edit applied SQL. Earlier source that knows only migration 001 rejects the
newer history; rollback requires a reviewed procedure. Application source must
also adopt list(query)/counts() and {tasks,nextCursor}. There is no automatic
framework updater. Source tests verify a retained legacy database and exact IDs;
the native persistence gate traverses 1029 tasks, filters/counts and cursor-row
deletions across actual HTTP processes. See [migrations](migrations.md),
[pagination](pagination.md), [task counts](task-counts.md) and [testing](testing.md).
