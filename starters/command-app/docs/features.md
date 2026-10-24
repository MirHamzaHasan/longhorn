# Feature connections

| Feature | Owner | Connections |
| --- | --- | --- |
| [Locked dependencies](dependencies.md) | pnpm-lock.yaml and .longhorn/distribution.json | Local framework overrides, fixed external resolution and explicit updates |
| [Account access](accounts.md) | src/accounts.ts | Native scrypt, AuthService, HttpOnly session cookies, exact Origin |
| [Password changes](password-changes.md) | src/accounts.ts and auth password capability | Current-password verification, fenced login, explicit functions and atomic session revocation |
| [Commands](commands.md) | src/operations.ts, operation-contracts.ts | Hono validation, DI, transaction-locked identity, scoped request replay |
| [Command history](history.md) | src/command-history.ts | Owner predicates, int64 cursors, live outgoing metadata |
| [Atomic writes](transactions.md) | operations.ts, @longhorn/idempotency, @longhorn/outbox | Business command, history association, replay and outgoing record in one managed transaction |
| [Remote delivery](delivery.md) | src/operation-transport.ts | Explicit protected HTTP receiver, bounded transport, dispatcher leases |
| [Receipt effect](receipts.md) | receiver/receiver.ts, receipts.ts, message-effect.ts | Validated numbers, SQL effect dedupe, matching synchronous acknowledgement |
| [Operator recovery](recovery.md) | operations.ts and console/app.ts | Conditional allowance, deliberate retry, durable account-attributed audit |
| [Browser](console.md) | console/app.ts and app.css, src/console.ts | Relative APIs, fixed CSP assets, light/dark responsive layouts |
| [Runtime](lifecycle.md) | src/operator-host.ts | Typed configuration, DI/lifecycle, role checks, readiness and graceful shutdown |
| [Deployment](schema.md) | src/operations-migrations.ts, runtime-grants.ts | Complete immutable schema history, separate owner/runtime authority |
| [Offline checkpoint](backup.md) | scripts/state-backup.mjs | PostgreSQL archive, stopped receipt storage, integrity checks and replacement targets |

The source in `.longhorn/framework` is the compiled, versioned dependency
snapshot. `pnpm-workspace.yaml` overrides every transitive @longhorn dependency
to those local copies. Changes to application source do not change the framework.
Replace the versioned numbers contract, business repository and receipt effect
together when adapting the example. Preserve atomic enqueue, scoped identities,
consumer dedupe, bounded retries and audit policy. See [setup](setup.md),
[recovery](recovery.md) and [deployment](deployment.md).
