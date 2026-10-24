# Password-change HTTP routes

Owner: `examples/auth/src/app.ts` and optional PostgreSQL account routing in
`examples/postgres/src/accounts.ts`. The native SQLite auth hosts and independent
auth starters enable POST `/auth/password`. The PostgreSQL operator host enables
POST `/account/password`; custom PostgreSQL apps must explicitly enable
`accounts.passwordChanges` and deploy/grant the matching functions first.

```json
{"currentPassword":"your current passphrase","nextPassword":"a different long passphrase"}
```

Cookie/origin middleware runs first. A user must be authenticated before route
validation; unsafe methods require the exact configured Origin. JSON is strict:
client user IDs, roles and encoded hashes are rejected. Existing 8 KiB body bounds,
`no-store`, HTTP-only/SameSite cookies and configured HTTPS policy remain in force.

The service authenticates the initiating token again, verifies the current
password, derives the replacement and rechecks credential/session ownership at
commit. Success is 204 with the cookie cleared and no newly issued session.
Every existing subject session is revoked, including other hosts/devices.
Other users, roles and private notes remain. Sign in with the new password.

Invalid input is 400; invalid current credentials or stale/revoked session are 401;
durable account throttling is 429 with Retry-After; native queue capacity is 503.
A wrong current password leaves a still-valid session intact. Storage failures
remain server failures and never return password/hash material. The browser
[Account page](console-account.md) uses this API with confirmation, an explicit
session probe for reauthentication 401, and sign-in after success/uncertainty.
See [service policy](password-changes.md), [SQLite](sqlite-password-changes.md),
[PostgreSQL](postgres-password-changes.md) and [testing](password-change-testing.md).
