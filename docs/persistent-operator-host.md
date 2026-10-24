# Persistent account operations host

Owner: `examples/postgres/src/operator-host.ts`. Connects
[accounts](account-operations.md), [configuration](operator-host-configuration.md),
[provisioning](operator-provisioning.md), [HTTP delivery](outbox-http-publisher.md)
and [protected receipts](operator-receipt-transport.md).

This executable uses a database you provision and a separately configured durable
receiver. It never starts/stops your database service or deletes application data.
The existing demo:operator-accounts remains an explicitly temporary sandbox.

This host now enables [authenticated password changes](password-change-http.md)
at POST `/account/password`, requiring the appended password migration and two
specific function grants. Current-password verification happens outside SQL and
success clears all subject sessions. The browser console has no settings screen
for this API yet. Stop old login writers during the documented upgrade.

1. Provision PostgreSQL owner/runtime roles and deploy the full operations profile
   using pnpm migrate:account-operations in the provisioning shell. Apply the
   grants documented in the provisioning/roles guides.
2. Start pnpm dev:message-receiver with a random RECEIVER_TOKEN and retained
   RECEIVER_DATA_PATH.
3. Configure examples/postgres/.operator.env with the restricted DATABASE_URL,
   receiver base URL/token and exact browser origin. Keep migration credentials
   out of this shell/profile.
4. Run pnpm dev:operator-host. It builds dependencies and starts the Node host.
5. Register/sign in through the existing account routes. Grant a registered
   operator through the separate trusted CLI, then sign in again.

Members POST /account/commands and read their own command/receipt IDs. Operators
inspect/retry failed deliveries and read audit history. The protocol and user
scope are unchanged from the account demo. Session hashes/roles, request replay,
business rows, outgoing attempts and audit identities live in PostgreSQL;
deduplicated computed effects live in receiver Object SQL.

On restart, a dispatcher resumes pending work and reclaims expired running leases
under the existing Queue protocol. It does not reset attempts, revive exhausted
records or create new message IDs. A receiver commit followed by a lost response
or publisher SIGKILL can repeat delivery; the receipt's stable ID retains one
effect. Failed attempts remain deliberately recoverable by a verified operator.

The host uses the existing app's DI, readiness, account middleware and lifecycle.
The composed app includes its public task/report APIs and protected account APIs.
Report workers/scheduler timers are disabled in this profile; the command Outbox
dispatcher is independently controlled. Shutdown closes listeners/drains HTTP,
then the dispatcher/Outbox before the pool. Signals during startup also await
acquisition before closing. Startup errors close acquired resources.

Restart persistence depends on retaining both the PostgreSQL deployment and
receiver storage, and supplying the intended service credentials. Native tests
prove independent process restarts, interruption after committed effect,
credential rotation, owner rejection and audited outage recovery. No cloud
deployment or backup/replication policy is implied.
