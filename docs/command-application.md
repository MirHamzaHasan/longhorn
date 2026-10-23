# Complete command application walkthrough

This example connects the framework through one usable workflow: an account
submits numbers, follows a durable outgoing delivery and reads a computed receipt.
An operator can recover failed delivery with an attributed audit trail.

```sh
pnpm install
pnpm demo:operator-accounts
```

Open http://127.0.0.1:3010/console, choose Create account and enter a username and
a password of at least 15 characters. Create a command containing `4, 8, 15`.
Open its detail and Refresh status. Its receipt has count 3, sum 27, minimum 4
and maximum 15. Commands returns to your owned history. Sign out and sign back
in to inspect the same rows. Another member cannot read them.

For recovery, create a separate operator account. In the running demo terminal,
enter `grant USERNAME`, then sign in again as that account. The trusted role
change revokes previous sessions. Enter `fail-publisher`, submit another command
and refresh until delivery is Failed. Enter `restore-publisher`, open Deliveries
as the operator, inspect the failed record, choose Provider restored and retry
with one additional attempt. Refresh status, read Recovery audit and then open
the member's original command receipt. The IDs remain the same across recovery.

The demo owns temporary PostgreSQL, broker and receipt storage and removes it
on Ctrl+C. For retained state, follow [persistent hosting](persistent-operator-host.md)
and [receiver setup](http-message-receiver.md). Use [native console verification](console-testing.md)
to repeat the browser flow automatically, including response loss and stale retry.

## How the pieces connect

| Step | Owner and contract | Durable effect |
| --- | --- | --- |
| Sign in | AuthService, native scrypt, PostgreSQL auth store | Hash-only session and HttpOnly cookie |
| Submit numbers | Hono validation and request DI | Principal-derived owner, no client role claim |
| Commit command | Managed PostgreSQL transaction, scoped Idempotency, Outbox | Command/history association, outgoing message and replay result commit together |
| Deliver | Lifecycle-owned dispatcher and explicit publisher | Fenced attempt/lease updates; stable message ID |
| Compute receipt | Existing Worker consumer and ReceiptStore | Atomic effect dedupe under the message ID |
| Read progress | Owner-scoped history/detail and guarded receipt reader | Explicit metadata with independent retention |
| Recover | Transaction authentication and authorized Outbox retry | Conditional ceiling/state change plus attributed audit |

Application policy lives in `src/accounts.ts` and `operations.ts`; contracts in
`operation-contracts.ts`; repositories in `command-history.ts`; DI/lifecycle in
`app.ts`; schema composition in `operations-migrations.ts`; persistent transport
and configuration in `operator-host.ts`. The browser is in `console/`. The receiver
and computation live in `examples/outbox-worker/src`.

To adapt it, replace the validated numbers contract, business repository and
consumer effect together. Keep identity derived from the server, enqueue and
business writes in one managed transaction, publish after commit, dedupe the
consumer effect and preserve explicit recovery/audit policy. Existing guides in
the [feature index](features.md) describe each boundary and its native proof.
