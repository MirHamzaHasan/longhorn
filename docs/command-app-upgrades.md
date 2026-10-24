# Command application upgrade procedure

Owner: deployment operator and the immutable operations migration profile.
Connects [history upgrade](command-history-migrations.md),
[artifact](command-app-distribution.md) and [backup/restore](command-app-backup.md).

1. Preserve the previous application/framework artifact and private configuration.
   Review the new source, complete migration list, dependency versions and ingress
   allowlist. The archive includes its [dependency lock](command-app-dependencies.md);
   retain/review it and use `pnpm install --frozen-lockfile` from the first install.
2. Stop application/receiver writers and create a coordinated offline checkpoint.
   Verify restore into isolated replacement database/storage before replacing
   service state. Keep external role/password/service secrets separately.
3. Install/typecheck/test/build the new artifact without copying node_modules or
   replacing its framework snapshot with workspace links. Merge deliberate local
   application changes before deployment.
4. Run the complete migrate command using the schema owner. Never edit/reorder a
   deployed migration prefix or use the shorter normal PostgreSQL example profile
   after operations is deployed. Command-history migration takes DDL locks and
   backfills retained rows, so schedule it in the maintenance window.
5. Reapply intended runtime grants and verify the runtime role has no owner,
   user/audit mutation, administrative, CREATE or SET ROLE capability. Keep
   MIGRATION_DATABASE_URL out of the application shell. Confirm exact HTTPS origin,
   secure cookies, receiver capability, URL and retained storage.
6. Start receiver and app, check private readiness, sign in and verify history,
   receipts, audit, same-key replay and one new computed command. Admit traffic
   after these checks. Rotate service credentials deliberately on both hosts.

Application rollback alone does not reverse a schema migration. If incompatible
state must be rolled back, use the verified replacement-state procedure; preserve
any writes after the checkpoint according to the deployment's recovery policy.
There is no automatic down migration or lossless cross-system rollback claim.
The legacy history upgrade interruption/rollback and concurrent migration behavior
are separately proven in [native history verification](command-history-testing.md).

The password-change revision appends its two function definitions after that
complete history and requires refreshed explicit runtime grants. Stop every old
login writer before enabling mutations; upgraded login-only stores also honor the
[credential fence](password-session-fencing.md). The
[password upgrade guide](postgres-password-changes.md) records the grants and rollback
boundaries. Never splice the new migration into an already deployed prefix.
