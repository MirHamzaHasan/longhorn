# Live command history verification

See the [development handoff](development-handoff.md) for the last verification.

Owners: [unit collector tests](../examples/postgres/console/history-live.test.ts),
[existing timer tests](../examples/postgres/console/command-follow.test.ts) and
[native browser gate](../scripts/verify-history-live.mjs). Connects
[feature](command-history-updates.md), [lifecycle](history-update-lifecycle.md),
[controls](console-history-updates.md) and [independent application](command-app-testing.md).

```sh
pnpm test:history-live
```

Build completes before compiled gates. Unit tests verify captured inputs, public-only
projection/legacy metadata, exact 200-row/two-read bounds, duplicate/loop/partial
rejection, original errors and cancellation without partial publication. Existing
controller tests verify serial settled admission, hidden/offline pause, explicit
restart, count/wall-time limits, active abort and disposal with ignored late results.

The native gate owns temporary restricted PostgreSQL, real scrypt accounts/HTTP,
actual outbox dispatch and a workerd broker/receipt. Actual HTTP creates more than
200 commands. Without manual refresh, new rows and computed delivery results
appear; all loaded rows remain in the refreshed window; a live Pending filter empties
and gains a later command. It checks saved/search/export inputs, link identity,
focus/scroll, query context, owner isolation, live operator denial and real SELECT
withdrawal/recovery. A held actual second response proves atomic two-page publication
and cancellation; deeper paging stops requests. Native browser hidden/offline,
navigation, network errors, cookie switching and actual expired sessions fence
reads. An owned paused tab reaches the real two-minute wall-clock limit.

Thirty-eight real light/dark/desktop/phone/scaled captures have zero AXE violations.
Records are written only after assertions pass to .artifacts/history-live-proof.json
and .artifacts/console/history-live/accessibility.json. Physical assistive technology,
cloud ingress/failover and a snapshot of concurrently changing history are not
proved by these finite local gates.

The independently installed archive and packed CLI app ship the actual source/tests
and local guides. Their complete restored browser/receiver workflow creates its
existing after-restore command and observes its new history row/delivered state
without refreshing, preserving exact command/receipt/replay/audit counts.
Existing history filters/search/links, exports, saved views and detail following
retain their own browser regression gates. CI runs the live-history gate and retains
its screenshots/proof plus the independent distribution observations.
