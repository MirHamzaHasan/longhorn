# Durable sessions

Owner: `SessionManager` and `SqliteAuthStore`, composed through AuthService.
Tokens come from Web Crypto; only token hashes reach SQLite. Public HTTP JSON
contains user fields and expiry, never raw tokens or password hashes. The token
is delivered through the [HTTP-only cookie](http.md).

Sessions expire absolutely, with a configurable TTL defaulting to eight hours.
GET `/auth/session` returns a current principal or 401. A login with an existing
cookie atomically replaces the old token. POST `/auth/logout` revokes the current
token and clears the cookie; POST `/auth/logout-all` revokes that user's sessions
across devices and hosts using the same file. Other users' sessions remain valid.
[Password replacement](password-changes.md) also revokes every subject session;
current login commits recheck the credential so an old verifier cannot issue later.

Current user roles reload from storage. There is no principal cache to invalidate.
Accounts/sessions survive native host restart; this is local retained SQLite,
not a distributed database or a cross-machine session service. See
[migrations](migrations.md), [accounts](accounts.md) and [testing](testing.md).
