# Native Object request limit verification

Owner: [verify-object-rate-limits.mjs](../scripts/verify-object-rate-limits.mjs), using
[test-only native fixtures](../scripts/fixtures/object-ratelimit.mjs). Connects the
[store](object-request-limits.md), [HTTP policy](object-report-limits.md),
[upgrade](object-limit-deployment.md) and [lifetime](object-limit-lifecycle.md).

```sh
pnpm test:object-rate-limits
```

This builds first, then runs pinned Miniflare 3.20250718.3/workerd with SQLite-backed
Objects at compatibility date 2025-07-18. All data paths, native hosts, external
hold gateway and subprocesses are owned temporary resources. The script writes
`.artifacts/object-rate-limit-proof.json` only after every assertion passes. The
source/runtime CI job runs the same gate and retains that artifact when available.

The fixture imports the actual store, Object SQL adapter and production report
classes/app. It verifies:

- Forty native competing clients admit exactly five; hashes, one expiry and count
  saturation persist. A queued event samples time after the native input gate.
- Live policy/SQL failures preserve the row and actor; an injected failure after
  the final actual update rolls back with the original error identity.
- Actual actor abort before commit rolls back; abort after commit retains the
  attempt and an explicit retry denies. A whole workerd restart retains counters.
- Table-wide pruning removes bounded expired prefixes across scopes, preserving
  live rows. Limiter close and HTTP close wait for held real native transactions;
  database close comes last and the platform binding stays usable.
- Both exact previous report migration profiles/effects survive a failed native
  suffix, then upgrade with unchanged history checksums and bucket schema last.
- Oversize input precedes quota. Direct jobs and schedules share attempts; invalid
  payloads/repeated schedules count. Denials preserve jobs/schedules/results.
- Exhausted scheduled/alarm apps still compute sums 8, 3 and 12. Quota-only work
  creates no alarm and denial preserves an adequate existing wakeup. Retained
  expiry replenishes the budget and another automatic job computes 16.
- The actual shipped scheduled and alarm Node launchers, in separate processes,
  forward settings, retain budgets and compute 24. Disable/re-enable preserves
  the old budget while an unmetered report computes 11. A changed live policy
  returns a private 503, forwarded identity is ignored, private tick remains 404,
  and invalid config exits before creating the selected data directory.

`pnpm test` separately covers the shared typed config/parser defaults and bounds.
Existing worker-storage, worker-alarm and transaction-publishing gates remain
regressions for the modified shared app. The local pinned workerd can emit an
unread-body diagnostic on the deliberately oversized early rejection; assertions
still require the actual 413 and unchanged quota state.

These are finite local native proofs, not evidence of cloud replication/failover,
production ingress policy or quotas shared across different Object owners. The
public demo has one fixed application identity; authenticated tenant routing is a
separate application design. Scheduled quota retention maintenance is not installed.
