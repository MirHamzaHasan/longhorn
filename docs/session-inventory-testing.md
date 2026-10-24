# Session inventory native verification

Owners: [native gate](../scripts/verify-session-inventory.mjs),
[browser gate](../scripts/verify-session-inventory-console.mjs), and the existing
[independent command workflow](command-app-testing.md). Connects
[service](session-inventory.md), [schema](session-inventory-schema.md),
[cursors](session-inventory-cursors.md), [providers](postgres-session-inventory.md),
[HTTP](session-inventory-http.md) and [Account UI](console-session-inventory.md).

```sh
pnpm test:session-inventory
```

Build finishes before compiled gates. All databases, native child groups, Object
storage, gateway, browser contexts and installs are owned temporary resources.
Proof records appear only after assertions pass: .artifacts/session-inventory-native-proof.json
and .artifacts/session-inventory-console-proof.json. Captures/AXE output live under
.artifacts/console/session-inventory. These finite local proofs do not claim cloud
failover, physical assistive-technology coverage or a durable device inventory.

Actual Node/Bun/Deno SQLite and restricted PostgreSQL start old sessions/profiles,
fail an appended suffix, then upgrade with unchanged legacy hashes/expiry/checksums.
Unchanged writers generate native public references after upgrade. Sixteen live
owner sessions traverse bounded pages; foreign and expired rows stay out. Cursors
bind owner and initiating session. Results/cursors expose no raw token/hash.
Selected/current revocation, repeat/foreign zero results, rollback/error identity,
reciprocal ownership, unsupported PG isolation and expiry after a real native wait
are verified. Actual SIGKILL before/after commit on all four SQL runtime profiles
preserves rollback versus committed deletion and explicit retry observations.

Pinned workerd executes real Object SQLite trigger/default references, reads,
rollback and selected deletion. A separate client waits behind an actual native
input gate and observes the advanced trusted-clock expiry. No production helper
route or cloud deployment is introduced.

The browser gate uses real scrypt/PostgreSQL/HTTP: public fields/current marker,
capability-off behavior, body/query/origin denial, foreign protection, manual pages,
confirmation/cancel focus, one submission, selected/current revocation, enabled
sign-in after completion, stale navigation and permission withdrawal/recovery.
A lost committed response requires sign-in. A cookie-switched page cannot mutate
another account. Bulk controls refresh the panel. A real blocked SQL request holds
app/pool shutdown; a later valid password login remains possible. Thirty actual
light/dark/desktop/phone/scaled captures have zero AXE violations.

Independent archived and packed-CLI command apps install/build/test their actual
source. The complete browser/receiver/backup/restore workflow verifies stable
session references after restore and real selected revocation without changing
commands/deliveries/replay. Node/Bun/Deno native auth hosts also verify public HTTP pages, initiating-session
cursor binding, query/body/origin denial and selected/current cookie revocation
across actual processes. All three packed-CLI auth apps verify the appended native
profile and real selected revocation through their copied source. Unit tests add frozen inputs, protocol failures, canonical public-only
projection and client page validation. The command asset bound grows to 160 files;
other profiles retain 128, and path/hash/byte validation remains unchanged.
