# Request limit verification

Owners: scripts/verify-rate-limits.mjs and scripts/verify-command-limits.mjs.
Run pnpm test:rate-limits after a frozen install. Source cases run in pnpm test;
all packages/apps are built and typechecked independently.

The package gate starts actual Node, pinned Bun and Deno processes with their
native SQLite providers. Each checks shared concurrent limits, real write
contention with post-ownership time sampling, invalid pending rows, hashed subjects,
expiry/policy conflict and bounded pruning. A finite real workerd invocation
checks memory/Hono behavior without claiming worker SQL support. Memory capacity,
HTTP privacy and reentrant close are exercised in the same compiled contract.

Restricted PostgreSQL clients compete for the same bucket, then wait on a native
row owner while the clock advances. A missing UPDATE grant rolls back without a
bucket. Runtime pruning is denied; a separate owner removes bounded expired rows.
Separate SQLite and PostgreSQL child processes are SIGKILLed after final counter
SQL before commit and after commit. Retry admits the rolled-back attempt and
retains the committed denial. Tests own every process, database and temporary path.
Evidence: .artifacts/rate-limit-proof.json.

The command gate upgrades the exact previous 005 profile. A real killed DDL
transaction preserves its ledger; two owner processes append one new migration
between them. Old IDs/checksums remain identical. Disabled schema/role checks work
before the new table exists. Minimal grants pass; excess maintenance DELETE and
schema CREATE are rejected. Two actual HTTP hosts/sessions share account quotas,
while another account is isolated. Origin/auth/body guards precede the budget;
invalid JSON and replay consume attempts. 429 preserves command/outbox/replay
counts, reads remain available, logout/login cannot reset a bucket and replenishment
retains the original stable-key replay. Revoke/regrant UPDATE proves 503/readiness
failure/recovery and disabled compatibility. A held real SQL write keeps HTTP and
pool shutdown pending. Evidence: .artifacts/command-limit-proof.json.

The complete archive and packed installed CLI gates run with limits enabled.
Preflight checks missing UPDATE and excess authority without consuming a bucket.
The real console/receiver computes receipts and offline backup/restore retains
exact bucket rows. Both flows recheck after restore; the installed project retains
its existing [source development proof](command-development-testing.md).
These are finite native local proofs, not a hosted load test or a claim of ingress
protection. See [contract](request-limits.md) and [application](command-request-limits.md).
