# Password reset

Owner: `PasswordResets` in `@longhornjs/auth`, with stores in `@longhornjs/auth/sqlite` and
`@longhornjs/auth/postgres`. Routes are shown in `examples/auth/src/app.ts`. Connects to
[session fencing](password-session-fencing.md) and [password changes](password-changes.md).

## Use

LongHorn holds no contact details and has no email integration, so you supply the delivery:

```ts
import { PasswordResets } from '@longhornjs/auth'
import { SqliteAuthStore, SqlitePasswordResetStore, sqlitePasswordResetMigrations } from '@longhornjs/auth/sqlite'

// Add sqlitePasswordResetMigrations after your deployed migrations.
const resets = new PasswordResets(new SqliteAuthStore(db), new SqlitePasswordResetStore(db), passwords, {
  deliver: async ({ user, token, expiresAt }) => {
    await mailer.send(await emailFor(user.id), `https://example.com/reset?token=${token}`)
  },
})

await resets.request('alice')                // Same result for every account.
await resets.confirm(token, nextPassword)    // Throws PasswordResetError if the token is unusable.
await resets.prune()                         // Run on a schedule. Removes expired tokens.
```

Delivery runs after the token commits. A rejected delivery rejects `request`, and the token stays
until it's replaced or it expires. Don't log the token, and keep it out of URLs that reach third parties.

## Routes

Respond before doing any work, as the example does. `request` takes longer for a real account, so
awaiting it would reveal which accounts exist. Run it with `app.run`, so closing the application
drains it.

| Route | Reply |
| --- | --- |
| `POST /auth/password-reset/request` `{"username"}` | Always 202 with the same body |
| `POST /auth/password-reset/confirm` `{"token","nextPassword"}` | 204, or 400 for an unusable token or weak password |

The example only has these routes when an application passes `deliverPasswordReset`. Its native hosts
don't, because they have no way to reach a user.

## What it guarantees

- Tokens are 256 random bits, and only their SHA-256 hash is stored.
- A token works once. A new request replaces the earlier token.
- Tokens last 30 minutes by default, and the lifetime is configurable from one minute to one day.
- A token is bound to the password it was issued against, so changing the password kills it.
- Spending the token, replacing the password and deleting every session commit together.
- Requests are limited to 5 per username per hour, and extra requests look the same to the caller.
- A login that checked the old password before the reset can't get a session after it.
- A successful reset lifts that username's login lockout.
- An unusable token is deleted when it's tried. A weak password doesn't spend the token.

## PostgreSQL

Deploy `postgresPasswordResetMigrations` and grant EXECUTE on `postgresPasswordResetFunctions` to the
runtime role. It needs no access to the table. The functions take the same per-user lock as password
replacement. Call `checkPostgresPasswordResetFunctions` at startup. Transactions must be READ COMMITTED.

## Verification

`pnpm test:password-reset` runs on real SQLite and real PostgreSQL as a restricted role. It covers
eight concurrent confirms of one token, a login verified before the reset, a login racing the reset,
a password changed after issue, expiry, pruning, denied table access and function hardening. Unit
tests are in `runtimes/node/src/password-reset.test.ts`, and HTTP tests in `examples/auth/src/app.test.ts`.

## Limits

- No email sending, and no way to recover an account with no known contact.
- No email verification or MFA, so whoever controls the delivery channel controls the account.
- The request limit is per username. Limit by IP at your edge too, or one client can trigger the delivery
  for many accounts.
- `request` is not retried. Hand delivery to the [outbox](outbox.md) if it has to survive a crash.
- Node SQLite and PostgreSQL ran. Bun, Deno, D1 and Durable Object SQLite have not.
- Removing the outstanding token on deletion relies on foreign keys being enforced.
