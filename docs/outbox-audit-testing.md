# Native recovery audit verification

Owner: `scripts/verify-outbox-audit.mjs`, audit process/Worker fixtures and
`examples/jobs/src/outbox-audit.test.ts`. Connects [API](outbox-audit.md),
[schema](outbox-audit-storage.md), [identity](outbox-audit-attribution.md),
[atomicity](outbox-audit-atomicity.md), [history](outbox-audit-history.md),
[retention](outbox-audit-retention.md) and [HTTP](outbox-audit-http.md).

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm test:outbox-audit
```

Source tests use real SQLite for actor/reason/result records, immutable messages,
all result categories, invalid attribution, audit-trigger failure rollback, one
grant/multiple action events, tied/scoped history pages, history after job deletion,
independent bounded retention, close drain and failure on an undeployed audit schema.
Type negatives require attribution and distinguish audit from delivery cursors.

Native SQLite/PostgreSQL processes pause a complete production audited callback
inside the real native transaction before outer commit. Independent readers see
old state/no event; SIGKILL rolls both back. Killing after normal commit retains
both. Competing operator processes have one state winner and separate scheduled/
conflict events. The PostgreSQL gate revokes audit INSERT, proves state rollback,
restores it and proves a later successful action. Audit UPDATE/DELETE remain denied
to the normal runtime. A separate role with only audit SELECT/DELETE and schema
USAGE proves bounded maintenance without queue or audit UPDATE privileges.

The Object fixture seeds the prior complete command/recovery history and actual
broker-accepted failed message, then the compiled app appends the audit schema.
Native authorization/reason/actor-spoof validation leaves no invalid events. Actual
state.abort after retry's alarm write rolls back state/ceiling/event/wakeup and
changes boot identity. Two valid authorized requests commit one grant and two
events, followed by automatic stable-ID broker redelivery and one receipt. Tests
also cover history after live-job pruning, HTTP cursor/filter checks, bounded audit
retention, host restart, disabled routes and credential/actor-label rotation.

The local launcher exercises actor binding and authorized audit write/read over
TCP, rejects unauthorized reads, keeps credentials out of output and disposes its
owned workerd on signal. Fixtures own every temporary path, child, pool, Miniflare
host and PostgreSQL cluster and clean them on success/failure. Normal data/cloud
accounts are untouched. Existing recovery/outbox/project gates protect prior APIs,
native broker/alarm behavior and archive packaging. These checks do not establish
tamper-proof storage or human identity for a shared service credential.
