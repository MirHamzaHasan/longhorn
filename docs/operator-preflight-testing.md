# Native operator preflight verification

Owner: operator-preflight.test.ts, CLI source cases and
scripts/verify-operator-preflight.mjs inside the complete archive/project workflow.
Connects [feature](operator-preflight.md), [format](operator-preflight-report.md),
[readiness](postgres-application-readiness.md) and [ownership](operator-preflight-lifecycle.md).

```sh
pnpm test
pnpm test:command-app
pnpm test:command-project
```

Twelve coordination cases use explicit probe doubles. They cover fixed/frozen
reports, cleanup opt-in, config rejection before acquisition, independent failures,
exact health success, failed first SQL, failed close, pre-abort, late connection
acquisition and held receiver work through cancellation. Real SQL/transport
behavior is verified separately rather than inferred from those doubles.

The native gate uses the actual built archive executable and installed relocated
CLI check command. Before the app ever listens, real native ports exercise invalid
runtime/owner config, missing console output, wrong database password, owner-role
rejection, revoked read authority, a temporarily missing view table and conditional
cleanup DELETE grants. Each temporary fixture change is restored by its owner.

The protected receiver rejects a wrong token. An owned HTTP peer returns an extra
secret-bearing health field or never completes; both fail within the existing
client policy without reflecting responses/credentials. A real PostgreSQL table
lock holds an admitted schema SELECT while SIGTERM requests exit. No report or
exit may arrive until release; then schema is cancelled, later phases skipped,
pool close passed and the native/CLI process exits 143.

Actual pending outgoing work and an expired replay row surround all probes. Counts
for business/account/job/replay/audit/view tables remain unchanged, the job stays
pending with zero attempts, no receipt effect appears, no app listener opens and
the expired row remains. A recovered final invocation passes. After the main
application's offline restore, the shipped check passes again alongside the real
browser/account/receipt/export workflow. Existing source development is retained.

Ignored operator-preflight-proof-archive.json and -cli.json under .artifacts record
aggregate outcomes. CI retains them after successful independent verification;
actual hosted execution/upload availability remains separate evidence. Fixtures
own all processes, sockets, grants, locks and temporary source/data. No production
database deployment or every-platform execution is implied by this local proof.

Optional [command attempt limits](command-request-limits.md) add bucket/access checks when enabled.
Preflight reports commandLimitsEnabled without consuming a bucket. Owner deployment
appends longhorn_rate_limit/001_buckets after the prior complete operations profile;
runtime grants add schema USAGE and table SELECT/INSERT/UPDATE, with no DELETE.
