# PostgreSQL tasks, background reports and accounts

Run pnpm demo:postgres from the repository root for an isolated temporary native
demo at http://127.0.0.1:3003. Ctrl+C removes the demo database. For a persistent
server you provision, configure .env, run pnpm migrate:postgres, then pnpm dev:postgres.

See [the app guide](../../docs/postgres-example.md), [provider](../../docs/postgres.md),
[transactions](../../docs/postgres-transactions.md), [migrations](../../docs/postgres-migrations.md),
[roles](../../docs/postgres-roles.md), [pagination](../../docs/postgres-pagination.md),
and [native demo/verification](../../docs/postgres-local.md) for connections and limits.

[Background reports](../../docs/postgres-reports.md) add POST /task-reports plus
once/interval/UTC-cron schedules. WORKER_ENABLED and SCHEDULER_ENABLED default true
in the executable; disable either for dedicated hosts. See [queue storage](../../docs/queue-postgres.md),
[schedule dispatch](../../docs/scheduler-postgres.md), and [native process proofs](../../docs/postgres-background-testing.md).

[Accounts](../../docs/postgres-accounts.md) add routes under /account: /register, /login,
/session, /logout, /logout-all and [private notes](../../docs/postgres-private-notes.md). State-changing
account requests require the configured Origin. Native scrypt, [credential storage](../../docs/auth-postgres.md),
[sessions](../../docs/postgres-sessions.md) and [shared attempts](../../docs/postgres-login-attempts.md)
keep their existing service boundaries; see [account proofs](../../docs/postgres-auth-testing.md).

Create a task and request its report in one commit:

```sh
curl -i http://127.0.0.1:3003/tasks/with-report \
  -H 'Content-Type: application/json' -d '{"title":"Ship the atomic producer"}'
```

The response includes the committed task and job, plus `Location` and
`Report-Location` headers. See [the route](../../docs/task-report-transactions.md)
and [transaction publishing](../../docs/postgres-transaction-publishing.md) for
database ownership, rollback and retry limits.

Use `-H 'Idempotency-Key: create-task-123'` to make matching retries return that
original committed task/job result for 24 hours. The response includes
`Idempotency-Replayed` and `Idempotency-Expires-At`; a changed normalized title
with the same unexpired key returns 409. See [HTTP idempotency](../../docs/idempotency-http.md)
for scope/retention and [role setup](../../docs/postgres-roles.md) for the new ledger grants.
