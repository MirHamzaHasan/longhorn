# Restricted PostgreSQL session controls

Owner: `PostgresSessionControlStore` and `checkPostgresSessionControls` from
`@longhorn/auth/postgres-session-controls`, also exposed through PostgresAuthStore.
Uses the existing session table/user index, SELECT/DELETE session privileges and
owner-deployed `longhorn_auth.lock_session_user(text)` function. The runtime does
not need direct UPDATE on users, roles, passwords or session expiries. This feature
adds no migration/function/grant to the complete operations history.

The port copies caller input, opens a managed transaction and requires actual READ
COMMITTED isolation. An indexed token lookup supplies only a subject hint. It then
takes the existing subject-exclusive transaction advisory lock using the same
`longhorn:auth-password:` namespace as credential-fenced login/password changes,
before acquiring any user/session row locks. The existing hardened transaction-auth
function freshly authenticates the token, locks user then session, and projects
only the required session identity/expiry. The result must match the hint/token.
The trusted clock is sampled after all ownership waits, before a scoped DELETE.

Serializing controls before row locks prevents reciprocal other-session deletions
from retaining each other's session locks. Existing login commits take the matching
shared advisory lock; password replacement takes the exclusive lock. A login that
commits first is visible to deletion; a replacement that invalidates initiation
first makes the control fail without deleting anything further. Normal role changes
and protected account operations continue to use user/session row ownership.
Hash collisions can cause extra serialization, never a different owner predicate.

READ COMMITTED is necessary for the fresh state after admission. The native provider
pins this isolation; nonconforming repeatable-read adapters fail before writes.
Storage/commit failures propagate with no automatic replay. Counts include only
live subject rows, while expired cleanup stays explicit. Large account revocations
use normal statement/lock timeouts; they do not return an unbounded row collection.

Enable `accounts.sessionControls` only after deploying/granting the existing
[transaction-auth capability](transaction-authentication.md). The operator host and
temporary demo enable it; readiness checks EXECUTE on that exact function. Normal
custom account profiles remain opt-in. New controls coordinate with current login
writers; raw/trusted session writers do not automatically join the advisory protocol.
A later successful login remains possible. See [service](session-controls.md),
[HTTP](session-controls-http.md), [proof](session-controls-testing.md) and
[password fencing](password-session-fencing.md).
