# Recovery actor and reason ownership

Owner: the calling application's verified identity/policy and the Outbox audit
input contract. Connects [authorization](outbox-operations-authorization.md),
[HTTP integration](outbox-audit-http.md), [audit schema](outbox-audit-storage.md)
and [existing account guards](authorization.md).

retryFailedAudited requires actor and reason. Actor is a stable application-derived
identifier, 1–200 ASCII characters: initial alphanumeric, followed by alphanumeric
or `._:@/-`. Reason is a code, 1–100 lowercase ASCII characters: initial letter,
followed by letters/digits or `._-`. Validation occurs before storage. These are
identifiers for attribution/classification, not free-form descriptions or payloads.
Do not put secrets in them; the library trusts its authenticated application caller.

For an account-based app, derive actor from the authenticated principal after its
role/tenant policy succeeds, such as user:<stable-user-id>. Do not accept a caller's
claim of actor identity as proof. Existing cookie/session/role guards can supply
that principal; the portable Outbox package does not import an authentication stack.
The [account example](account-operations.md) binds that identity to the
[authorized retry transaction](outbox-authorized-retry.md), so session/role changes
coordinate with the audit and transition through commit.

The shared-data Worker demo authenticates one deployment bearer capability. Its
server binding OUTBOX_OPERATIONS_ACTOR supplies a service identity and defaults to
service:outbox-operations. This labels the service credential holder, not a person.
All humans sharing that credential share the label. Incoming JSON actor fields are
rejected. Changing a configured actor changes future records only; old records keep
their original attribution across secret rotation and host restart.

The demo permits reason codes manual-retry, provider-restored, configuration-fixed
and investigating. Omitted reason defaults to manual-retry for existing clients.
Applications may choose their own code vocabulary within the library contract.
No credential hash or token is automatically used as an actor ID; the bearer value
is never an audit SQL parameter. The audit summary excludes message payloads, lease
tokens and arbitrary error strings.

Audit/history access and retention can expose actor identifiers and remain an
application policy. Queue binding scopes the built-in queries; PostgreSQL grants
are table privileges, not a tenant row-level policy. See [native policy proof](outbox-audit-testing.md).
