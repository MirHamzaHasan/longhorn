# Runtime preflight

After installation and `pnpm build`, configure the runtime profile and run:

```sh
pnpm check
# Or use the installed CLI:
longhorn check --cwd /path/to/project
```

The command emits one JSON report and exits 0 when every required check passes,
1 on failure, 130 for SIGINT or 143 for SIGTERM after admitted work drains. It uses
the same .operator.env/.operator.env.local and environment precedence as the host.
Keep MIGRATION_DATABASE_URL in the separate owner shell; it is rejected here too.

The report has schemaVersion=1, ready/cancelled, checks and optional capability
booleans. Check IDs are configuration, console-assets, database, schema, runtime-role,
receiver and database-close. Status is passed, failed, skipped or cancelled. Failed
checks carry a fixed hint. Supplied URLs, tokens, database names, SQL errors and
exception text are omitted. Custom application/compiler logging is separate.

The checker reads built console assets, probes PostgreSQL, reuses startup/readiness
schema checks and restricted-role policy, then performs the existing protected
receiver health GET. Independent checks can continue after another fails; dependent
SQL checks are skipped when their prerequisites fail. Enabled request cleanup adds
its existing ledger access check. Dispatch being disabled still needs the receiver
for protected receipt reads.

It starts no application listener, dispatcher, scheduler or cleanup worker. It does
not migrate, grant, mutate accounts, send messages or prune stored replies. The
acquired pool closes after admitted probes, including on interruption. Cancellation
is cooperative; database operations use their existing provider deadlines and are
awaited rather than abandoned. Close failure makes the report fail.

Use [setup](setup.md) for configuration/roles, [schema](schema.md) for the complete
owner deployment and [delivery](delivery.md) for receiver settings. A passing report
describes those observations at that moment; the host checks again at startup.
It does not prove future availability, deployment TLS/ingress, every mutation grant
or owner-only migration checksum history. No repair or provisioning runs implicitly.

Optional [command attempt limits](request-limits.md) add bucket/access checks when enabled.
Preflight reports commandLimitsEnabled without consuming a bucket. Owner deployment
appends longhorn_rate_limit/001_buckets after the prior complete operations profile;
runtime grants add schema USAGE and table SELECT/INSERT/UPDATE, with no DELETE.
