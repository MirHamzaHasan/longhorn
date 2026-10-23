# Persistent operations native verification

Owner: `scripts/verify-persistent-operations.mjs` and HTTP delivery fixtures.
Connects [persistent host](persistent-operator-host.md),
[receiver](http-message-receiver.md), [HTTP publishing](outbox-http-publisher.md)
and [transactional authorization tests](operator-accounts-testing.md).

```sh
pnpm test:persistent-operations
```

The gate owns a temporary native PostgreSQL cluster and a temporary receipt data
directory, then launches the actual compiled operator host and receiver processes.
It never uses or alters a user's database service. Archive checks require the
new public client, bearer and HTTP publisher exports/declarations in the bundled
CLI snapshot.

Built publishers/JSON clients run on Node, pinned Bun, permission-bounded Deno
and actual workerd against the real protected receiver over TCP. They send
duplicates and read one matching SQL effect. Receiver checks include denial
before validation, conflicting-effect rejection and persisted receipts after
process restart.

The operator host rejects migration credentials in its profile, actual schema
owner credentials, column-only password/audit UPDATE grants, malformed secrets
and non-HTTPS external service endpoints.
The valid host uses only runtime credentials. Native scrypt accounts, trusted
operator CLI grants and cookies connect to a user command. Normal host restart
retains sessions, roles, command ownership and the original idempotent result.

An owned forwarding fixture holds an acknowledgement only after the production
receiver has committed. SIGKILL stops the publisher in that gap. A restarted
host reclaims the native lease, resends the same envelope ID and reaches
succeeded with at least two attempts and one unchanged receipt. This directly
tests the ambiguity boundary rather than simulating successful delivery.

Stopping the receiver makes readiness fail, liveness remain healthy and receipt
reads return sanitized 503. Another durable command exhausts delivery attempts.
Restarting with a rotated receiver credential preserves old effects and rejects
the old capability. A verified operator deliberately retries; its user audit,
new receipt and original request result survive both processes restarting again.
Producer-only hosting is exercised too. Captured child output excludes passwords,
session/service credentials and database URLs. Test subprocesses have isolated
owned process groups; failure cleanup first requests graceful shutdown, then
removes descendants if a parent was killed. An actual receiver SIGKILL/restart
checks retained effects through that cleanup path too.

Source tests cover URL/path boundaries, redirect denial, byte limits, strict
acknowledgements, timeout/cancellation ownership, bearer syntax and configuration.
Existing broker/Outbox, audit, account and generated-project gates remain separate
regressions. Local persistence checks do not establish cloud failover, backups
or an arbitrary remote receiver's durability guarantees.
