# Schema deployment and grants

Owner: src/operations-migrations.ts, migrate-operations.ts and runtime-grants.ts.
The complete ordered migration list retains every deployed prefix and checksum.
Only the separate schema owner applies it. PostgreSQL advisory locking serializes
concurrent deployments; DDL and migration metadata commit together.

Trusted grant provisioning adds exact named resources in one transaction and
rejects administrative roles. It never creates logins or removes old excess grants.
The HTTP startup check refuses effective administrative, CREATE, SET ROLE, user
mutation or audit mutation authority. Database CONNECT and credentials remain
administrator-owned. Connects [setup](setup.md), [transactions](transactions.md)
and [backup](backup.md). Upgrade under the deployment maintenance procedure.

[History filters](history-filters.md) append
postgres_account_operations/003_history_filters after the complete existing
profile. Two partial indexes support fixed-queue state joins. Regular transactional
index builds block writes; use the maintenance window. Updated startup/readiness
requires valid/ready indexes on the expected tables. Existing grants suffice.

[ID search](history-search.md) appends 004_history_search with global and owner
lower-ID pattern indexes after the complete filter profile. Budget regular
transactional index builds in maintenance before updated hosts; startup/readiness
checks require valid/ready indexes, with the same runtime grants.

[Apply appended 005_history_views and rerun runtime provisioning for named preferences.](saved-views.md)

Optional [command attempt limits](request-limits.md) add bucket/access checks when enabled.
Preflight reports commandLimitsEnabled without consuming a bucket. Owner deployment
appends longhorn_rate_limit/001_buckets after the prior complete operations profile;
runtime grants add schema USAGE and table SELECT/INSERT/UPDATE, with no DELETE.
