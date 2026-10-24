# Authenticated session controls

Owner: src/app.ts, AuthService and its optional SQLite session-control capability.
POST `/auth/sessions/revoke` accepts strict `{ "scope": "others" }` or
`{ "scope": "all" }` using the normal cookie and exact Origin. Extra user/role/
token fields are rejected. Success is `{ "revokedSessions": number }`; others
preserves the initiating cookie, all clears it. Existing `/auth/logout-all` uses
the same transaction-owned reauthentication with its original 204 response.

The current token is rechecked inside native SQLite write ownership; the trusted
clock is sampled after waiting. Missing, revoked, deleted-user or expired initiation
fails without deletion. Others excludes the initiating token; counts/deletions
exclude already expired records. Other accounts, credentials, roles and notes stay
unchanged. The original schema/user index is sufficient; no migration is added.

A commit failure or lost response may be unconfirmed. Do not automatically replay,
because a later action could end newly issued sessions. Accepted operations are not
retroactively canceled, and a later successful login can create a new session.
This is not password replacement or a future-login ban. Use the separate
[password route](password-changes.md) to change credentials.

The optional pure service/store contract keeps custom stores compatible when disabled.
This generated app enables native controls on its selected Node/Bun/Deno database.
Repository checks use real concurrency, expiry, trigger failure and process death;
all eight copied app cases run on each selected native test runner. The generated
app exposes an HTTP API; it does not include the command application's browser UI.
See [sessions](sessions.md), [accounts](accounts.md), [testing](testing.md) and
[feature connections](features.md).
