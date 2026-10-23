# Offline application backup and restore

Owner: `starters/command-app/scripts/state-backup.mjs` and docs/backup.md. Connects
[persistent state](persistent-operator-host.md), [distribution](command-app-distribution.md)
and [schema upgrades](command-app-upgrades.md).

The archive's state:backup and state:restore commands require `DIRECTORY --offline`,
an explicit RECEIVER_DATA_PATH, an owner MIGRATION_DATABASE_URL and PostgreSQL 18
pg_dump/pg_restore. Stop every application and receiver writer first. The offline
flag declares that maintenance state; process discovery cannot prove it globally.

Backup stages a custom database archive, complete stopped receipt directory and
checksum manifest in a private directory, then renames to a new destination. It
refuses overlapping storage paths, existing destinations, symlinks and special
files in receiver storage. No URL/password is passed in child arguments. The
backup includes session/password hashes and private data; keep it private.
Checksums detect accidental corruption and are not a signature or trust boundary.

Restore validates the retained files/dump before changes and requires an empty,
separately provisioned PostgreSQL database and absent receiver path. It runs
pg_restore in one transaction with ownership/grants omitted and no clean/drop
option, then revokes default
PUBLIC execution on auth functions. The supplied schema owner owns restored
objects; deploy fresh restricted grants before admitting traffic. Database/role
globals, service credentials and external infrastructure are separate provisioning.

The two stores do not share a transaction. A late restore failure can leave a
populated new database without published receiver storage; inspect or replace
the new targets before retrying. Original state is not overwritten. This is a
single-host offline checkpoint, not automatic rollback, online cross-service
snapshot, replication or a production point-in-time recovery system.

[The native gate](command-app-testing.md) verifies actual pg_dump/pg_restore,
receipt directory relocation, corruption denial, full retained user workflow,
function ACL repair, restricted privileges and a new computed command. See
[PostgreSQL pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html) and
[pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html) for archive and
restore semantics. Full executable steps are included in the archive's backup guide.
