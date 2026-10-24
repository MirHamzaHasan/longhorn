# Read-only operator application preflight

Owner: examples/postgres/src/operator-preflight.ts and operator-check.ts, shipped
by the [command profile](command-project.md) and [standalone archive](command-app-distribution.md).
Connects [report format](operator-preflight-report.md), [shared readiness](postgres-application-readiness.md),
[probe ownership](operator-preflight-lifecycle.md) and [native proof](operator-preflight-testing.md).

After building and configuring the generated runtime profile:

```sh
pnpm check
longhorn check --cwd /path/to/my-console
```

In the repository, pnpm check:operator-host builds the PostgreSQL profile and runs
the same native entry. It reads examples/postgres/.operator.env and its local
override. Generated commands read their own project profiles. Both use the host's
shared loader and normal environment precedence, including rejection of owner
MIGRATION_DATABASE_URL in the runtime environment.

The command inspects readable built console assets, PostgreSQL connectivity,
runtime-visible schema/access, effective restricted-role policy and protected
receiver health. It closes its acquired pool and emits one versioned JSON report.
Exit is 0 for all checks passing, 1 for failure, or 130/143 after interrupted work
drains. Fixed hints point to the generated setup/schema/delivery guides.

No app listener, request cleanup, dispatcher, report worker or scheduler starts.
The tool does not run migrations, grant privileges, register users, send messages
or prune replay data. Existing protected receiver health is a GET; service-owned
health behavior remains that service's responsibility. Dispatch-disabled profiles
still need the receiver for protected receipt reads.

A pass describes observations at that time. Normal host startup and readiness
check again. This is not an owner-only migration checksum audit, proof of every
mutation grant, certificate/ingress verification or a promise of future availability.
Configuration, deployment and repairs remain explicit operator actions.

Optional [command attempt limits](command-request-limits.md) add bucket/access checks when enabled.
Preflight reports commandLimitsEnabled without consuming a bucket. Owner deployment
appends longhorn_rate_limit/001_buckets after the prior complete operations profile;
runtime grants add schema USAGE and table SELECT/INSERT/UPDATE, with no DELETE.
