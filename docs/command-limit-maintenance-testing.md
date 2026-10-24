# Native and installed command maintenance verification

Owner: [verify-command-limit-maintenance.mjs](../scripts/verify-command-limit-maintenance.mjs).
Connects [tool](command-limit-maintenance.md), [authority](command-limit-maintenance-role.md),
[lifetime](command-limit-maintenance-lifecycle.md) and [report](command-limit-maintenance-report.md).

```sh
pnpm test:command-limit-maintenance
```

The full build precedes compiled gates. The verifier owns its temporary PostgreSQL
cluster, roles, HTTP application, child groups and relocated installations. It
writes .artifacts/command-limit-maintenance-proof.json only after assertions pass.
CI connects the gate and retains its proof. No real user database is touched.

Native PostgreSQL verifies the actual compiled provisioning/check/once/watch
commands, complete current schema and minimal separate role. Missing schema never
creates a table. Provisioning the HTTP role fails atomically without adding DELETE.
Owner/runtime credentials, an extra bucket UPDATE column, column INSERT, public
schema CREATE, business column SELECT, delegated role, RLS and wrong expiry type
are rejected before a prune is admitted. Read-only check preserves exact bucket
rows; two actual one-shot processes remove two rows each while preserving live state.

A real account signs up/logs in and submits a protected command. Its exhausted
budget denies a repeat; after actual expiry, maintenance removes the bucket while
complete command/queue/outbox-audit/replay rows remain unchanged. A new admission
replays the same response/job rather than duplicating a command or delivery.

Actual table locks are observed through pg_blocking_pids for the maintenance
application name. SIGINT during once and SIGTERM during watch leave the process
pending until native release, then report acknowledged removals and documented
exit codes. Revoked DELETE produces a fixed warning; restoring it lets watch
remove a later expired row, while historical errors still make the final exit fail.
Migration IDs/checksums and the HTTP runtime authority remain unchanged.

The generated archive and an app created by an independently packed/installed CLI
are relocated, installed with frozen locks, typechecked, tested and built. Their
actual package scripts provision the role, check without writes, prune in batches
of two then one, preserve the exact live bucket, reject the runtime identity and
stop watch cleanly. Editable source/guides and private-file ignores are required
assets. Unit tests separately cover config, no-acquisition cancellation, held
one-shot drain, owned observer failure and private release failure.

These are finite local native proofs. This tool does not install a cloud scheduler,
cluster leader, command-host background task, new schema or new runtime grants.
