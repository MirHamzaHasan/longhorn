# Native operator account verification

Owner: `scripts/verify-operator-accounts.mjs`, its process/Object fixtures and
`examples/jobs/src/operation-principals.test.ts`. Connects
[account operations](account-operations.md), [transaction auth](transaction-authentication.md),
[PostgreSQL locks](postgres-transaction-auth.md) and [the runnable demo](operator-accounts-demo.md).

```sh
pnpm test:operator-accounts
```

The gate uses an owned native PostgreSQL cluster, the compiled account app over
TCP, real scrypt, the production Worker consumer and actual local broker/SQL
receipt storage. It checks member-only signup, trusted CLI grants, stale sessions,
401/403 gates before validation, actor/role spoof denial, origin/cross-site and
duplicate-cookie rejection. User-scoped keys replay independently; other members
cannot read commands/receipts. Competing operator retries produce one scheduled
and one conflict audit, both attributed to the verified user. Duplicate broker
delivery retains one effect. Rotation, logout/all and demotion deny later access.

The function inspection confirms nonsuperuser ownership, fixed search_path,
VOLATILE, revoked PUBLIC execution and no password projection. Runtime user/audit
UPDATE stays denied. A provisioning-only role works without password access;
denied session DELETE rolls its role change back.

Separate native processes retain authorization locks while actual raw session
DELETE, raw role UPDATE and trusted provisioning wait. pg_stat_activity confirms
the specific owned backend's Lock wait before release. First-writer role changes
and session expiry after waiting deny actions without audits. SIGKILL before commit
rolls back retry/audit, releases revocation and preserves the failed record.
Root/foreign executor scopes are rejected.

An actual workerd Object fixture exercises the SQLite account store, role-change
revocation, member denial and an attributed retry. An injected transaction abort
after retry/audit/native alarm writes leaves all three unchanged. This uses trusted
fixture session provisioning; no Worker password provider is introduced.

The runnable demo is separately launched, uses its trusted console, and receives
normal/startup SIGTERM. Owned resources are disposed and captured child output is
checked for credentials. The gate does not deploy cloud services or prove
multi-tenant RLS. Source SQLite tests complement it; the existing PostgreSQL,
Outbox recovery/audit and independent project gates remain regression coverage.
