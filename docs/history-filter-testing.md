# Native delivery-filter verification

Owner: scripts/verify-history-filters.mjs, verify-console.mjs and verify-command-app.mjs.
Run pnpm test:history-filters, pnpm test:command-history, pnpm test:console and
pnpm test:command-app. Build once before running the underlying scripts in parallel;
never clean-build while another gate reads compiled files.

The dedicated gate owns native PostgreSQL and a real TCP account application. It
starts from the exact previous migration profile, retains its checksums and rows,
holds new index DDL before commit and SIGKILLs that owner. Peer visibility, index/
ledger rollback, two-owner serialization and missing-index readiness are checked.
It provisions the existing restricted runtime privileges rather than an owner HTTP
connection. Connects [migration](history-filter-migrations.md) and [API](history-status-filters.md).

Actual Outbox leases and a controlled fixture publisher produce pending, running,
succeeded and failed jobs. Deleting only retained job metadata proves unavailable
history; an unrelated queue's job cannot attach. Requests verify principal scope,
explicit operator authority, duplicate/unknown claims, v1/all compatibility,
v2/status binding, other viewers, saved cursors after restart, positions above
Number.MAX_SAFE_INTEGER and actual role revocation. A metadata-only role can read
every filter but cannot SELECT numbers, payload or lease token. Source cases also
cover input mutation during an awaited read and strict malformed cursor rejection.

The scale fixture inserts 3,000 real jobs/commands, analyzes both tables and runs
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) on the actual captured repository query.
The rare-state plan must use both new indexes without forced planner settings.
Ignored .artifacts/history-filters-plan.json records that result. This proves the
measured fixture; it is not a latency bound or production-capacity claim.

The command browser gate uses actual receipts and live state. It covers failed,
delivered, unavailable and empty views; operator/global separation; Show all;
more than twenty actual delivered commands; changing the filter during a held real
continuation; and a failed command moving to Delivered after real operator recovery.
Six additional states add 24 theme/width captures plus two phone captures at 130%
text. The command suite now writes 117 captures and accessibility.json to ignored
.artifacts/console. The separate account suite remains 58 captures. Captured pages
require zero axe WCAG 2/2.1 A/AA violations and no horizontal overflow; physical
assistive technology and other engines remain manual checks.

The independently packed, relocated, frozen-installed app restores a real
checkpoint, reapplies restricted grants and restarts its shipped host/receiver.
Its browser filters retained plus newly rerun commands into Delivered, shows an
empty Failed view and clears back to all four commands before the existing session/
password regression flow. See [archive verification](command-app-testing.md).
