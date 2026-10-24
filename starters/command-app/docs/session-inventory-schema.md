# Session reference deployment

The normal owner migrate command appends longhorn_postgres_auth/004_session_inventory
after the complete prior operations history, including longhorn_rate_limit/001_buckets.
It adds a native UUID-derived public reference/default, unique reference index and
owner/expiry/reference paging index. Existing session hashes/expiry, AuthStore/
SessionManager interfaces and password-session functions remain unchanged.

No new runtime DML grant is required; old inserts omit the reference and the native
default fills it atomically. Existing lock_session_user authority and native
pg_catalog.gen_random_uuid execution must be available. Startup/readiness/preflight
check the new shape/access without deploying it. Owner credentials remain separate.

Backups retain references with session rows; restore uses the normal complete
profile/grants. Failed suffixes roll back data/schema/history. Keep deployment code
and manifests complete rather than removing newer history to downgrade.
See [Account inventory](session-inventory.md) and [shutdown](session-inventory-lifecycle.md).
