# Native D1 request limit verification

Owners: scripts/verify-d1-rate-limits.mjs, its privileged temporary fixture and the
existing installed D1 project gate. Run pnpm test:d1-rate-limits; source cases run
in pnpm test. Pinned Miniflare/workerd use compatibility date 2025-07-18. Tests own
all temporary workers and retained directories and never deploy to a cloud account.

The real D1 binding proves native SQLite time while JavaScript Date.now is zero,
whole-batch reservation rollback, committed lost acknowledgement without implicit
retry, explicit retry counting, bounded table-wide expiry pruning and live bucket
preservation. A held actual post-commit D1 result proves reentrant limiter close
and application HTTP/limiter/database drain. No fake SQL provider supports these
native claims; fake source cases separately validate malformed result/bound errors.

A prior complete task/activity/request profile is deployed first. A failing native
upgrade leaves its exact history and task intact. Two owner workers race the real
suffix, followed by an idempotent rerun. HTTP startup does no schema writes. New
code stays unavailable until its complete deployment profile is present.

Two actual application workers share public task attempts. Oversized body is
rejected before consumption. Stable-key replay and malformed JSON count; denial
returns Retry-After/no-store with unchanged task/activity/replay counts. A changed
live policy returns 503 without changing its row. Reads remain available, and an
explicitly disabled worker keeps default creation behavior. Failed activity SQL
rolls business state back while retaining its attempt. Missing bucket storage
fails closed and recovers after restoration. Actual workerd restart retains state.
Forty concurrent reservations across two fixture workers admit exactly five.
Evidence: .artifacts/d1-rate-limit-proof.json.

The generated starter ships and runs its own two-worker opt-in/replay/429/read/
retained-budget proof. The packed installed CLI is relocated, frozen-installed,
typechecked/tested/built and exercised through actual native hosts and development
reload. Separate CLI host processes retain the budget; expiry recovers the original
stable replay. Its proof is .artifacts/d1-rate-limit-project-proof.json. Existing D1
storage/idempotency/upgrade/input/authority boundaries are rerun. CI retains both proofs
in the D1 job. These finite local tests do not prove remote D1 replication, latency,
failover or backup/restore behavior. See [API](d1-request-limits.md) and
[deployment](d1-limit-schema.md).
