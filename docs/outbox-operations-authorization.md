# Operations authorization boundary

Owner: `examples/outbox-worker/src/operations.ts` and host configuration. Connects
[operations HTTP](outbox-operations-http.md), [library retry](outbox-deliberate-retry.md),
[existing account guards](authorization.md) and [the Worker example](outbox-worker-example.md).

The Outbox library performs no authentication. Its caller owns the credential,
principal/tenant policy and authority to inspect or retry that queue. The example
is a shared-data deployment and uses one explicit bearer capability for operations;
it does not claim per-user identity or role enforcement. Its
[audit trail](outbox-audit.md) attributes the service credential holder through a
server-configured label, rather than claiming a human identity.
Applications with accounts should connect their existing authenticated principal
and role/tenant policy instead of treating this deployment token as a user account.
The [account operations example](account-operations.md) now implements that path
using the [shared Hono adapter](outbox-hono.md) and transaction-locked sessions.
The service configuration below retains its existing behavior.

Operations routes are absent by default. Setting OUTBOX_OPERATIONS_TOKEN opts the
host into them. Configuration accepts 32–256 ASCII alphanumeric, underscore or
hyphen characters; provide a cryptographically random secret through the host's
secret mechanism. For local development:

```sh
export OUTBOX_OPERATIONS_TOKEN="$(openssl rand -hex 32)"
pnpm dev:outbox-worker
```

Send it only as Authorization: Bearer <token>. The guard runs before operations
query/body handling, returns 401 with WWW-Authenticate: Bearer on missing/incorrect
credentials, and adds Vary: Authorization. Responses inherit Cache-Control: no-store.
Without configured operations the same paths return 404. Invalid configured token
format fails app construction without printing its value.

Verification uses an instance-local nonextractable Web Crypto HMAC key and native
MAC verification of the supplied credential against the configured one. The key/
comparison material is lazy and not persisted. Resetting an Object regenerates it
and still accepts the configured token. The token is never a URL parameter, message
payload, SQL value or response field. Launcher output contains no credential.

The local launcher passes the optional environment value as a Worker binding. A
deployment owns secure transport, secret distribution/rotation and operator access.
Changing that configuration requires the host to supply the new binding to fresh
instances. The public command/delivery/receipt demo routes retain their shared-data
policy; enabling operations does not add tenant authorization to them. Native tests
exercise disabled, unauthorized and authorized access, validation, actual mutation
and response/log secrecy. See [verification](outbox-recovery-testing.md).

OUTBOX_OPERATIONS_ACTOR optionally configures that stable service label. The default
is service:outbox-operations; client actor fields are rejected. Token values are not
derived into audit identities. [Reason/identity policy](outbox-audit-attribution.md)
and [native rotation proof](outbox-audit-testing.md) document the new history boundary.
