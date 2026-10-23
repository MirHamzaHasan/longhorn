# Offline backup and restore

Stop the application and receiver cleanly before using these commands. All writers
must stay stopped until the operation finishes. `--offline` is your declaration
of that maintenance state; the tool does not discover unrelated processes.
This is a consistent single-host maintenance checkpoint, not online replication
or a replacement for production point-in-time database backups.

In a private deployment shell, supply MIGRATION_DATABASE_URL for the schema owner
and RECEIVER_DATA_PATH for the stopped local receiver. PostgreSQL 18 pg_dump and
pg_restore must be on PATH, or set LONGHORN_PG_CLIENT_BIN to their directory.

```sh
pnpm state:backup /private/backups/command-checkpoint --offline
```

The destination must not exist and must be disjoint from receiver storage. A
private staged directory receives an uncompressed custom PostgreSQL dump, the
complete stopped receiver directory and a checksum manifest, then publishes by
rename. No database URL/password appears in child command arguments or output.
Protect this directory: it contains account password hashes, sessions, business
data and receipt effects. Checksums detect corruption, not authenticity. Restore
only backups from a trusted source. Role/password globals and external secrets
are not in the database dump and must be provisioned separately.

Restore into a newly provisioned, empty PostgreSQL 18 database owned by the schema
owner and a new, absent receiver directory. Supply the new owner's URL and receiver
path in the same environment variables, then run:

```sh
pnpm state:restore /private/backups/command-checkpoint --offline
pnpm migrate
pnpm provision:runtime longhorn_app
```

Restore validates every retained file/dump checksum before importing, rejects
occupied database/storage targets, and uses one PostgreSQL transaction without
DROP/clean options. Deployment-specific ownership/grants are intentionally omitted;
restored objects belong to the supplied owner. The auth function's default PUBLIC
execution is explicitly revoked before fresh restricted grants are applied.
Database CONNECT permissions, external service token and app configuration remain
your deployment's responsibility. Existing account roles are part of retained data.

Verify login, history, receipts, audit and a new command before admitting traffic.
The application and receipt directory do not commit together across systems. A
failure after the database restore may leave partial target state; inspect or
replace the new targets before retrying. Originals are never overwritten/deleted.
Do not claim an online cross-system snapshot or an automatic rollback.
