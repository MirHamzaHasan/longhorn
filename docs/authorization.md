# Authorization and resource ownership

Owner: guards returned by `cookieAuth` from `@longhornjs/auth/hono`, plus application
resource queries. Connects a fresh authenticated principal to Hono middleware and
the application's own data policy. It does not infer permissions from route names.

```ts
routes.get('/me', cookies.requireUser, (c) => c.json(c.get('auth')!))
routes.get('/admin', cookies.requireRole('admin'), adminHandler)
routes.get('/reports', cookies.authorize(async (user, c) => {
  return policy.canReadReport(user.id, c.req.query('report'))
}), reportHandler)
```

Run `cookies.middleware` before these guards. Anonymous requests receive 401;
authenticated users failing a role/policy receive 403. Policy callbacks may be
asynchronous. Exceptions propagate to the application's normal server error path,
not to a default allow decision. `c.get('auth')` contains a public user and session
expiry, without credentials or the raw session token.

Registration always assigns `member`. Roles are loaded from durable account state
on every authenticated request, rather than stored in the cookie or cached in the
process. Trusted operator/server code can change roles in that store; the next
request observes the change. Registration bodies cannot request admin privileges.
There is no public role-management endpoint in the example.

## Owner-scoped data

Authentication alone does not authorize access to an arbitrary object ID. The
[auth example](auth-example.md) binds resource access to the authenticated user:

```sql
SELECT id, title FROM private_notes WHERE owner_id = ? ORDER BY id;
DELETE FROM private_notes WHERE id = ? AND owner_id = ?;
```

Arguments come from the validated principal, not a client-supplied owner ID. Create
inserts that owner ID server-side. The delete query atomically enforces ownership;
another user's ID returns the same 404 as a missing note. A member cannot list or
delete another user's notes, and the example's admin role does not implicitly bypass
those owner predicates.

These are application policies. The framework does not add automatic tenant
filtering, database RLS, a role hierarchy, permission inheritance, or an external
policy engine. Each new resource must define and enforce its own policy. Sensitive
future actions such as password/role management should add reauthentication and
appropriate revocation. These ordinary guards authorize at admission; a concurrent
session or role change does not retroactively cancel an in-flight read. For SQL
mutations requiring coordinated revocation, use [transaction authentication](transaction-authentication.md)
and the same managed executor through commit. The [account operations example](account-operations.md)
implements that policy with trusted [role provisioning](operator-provisioning.md).

## Verification

Hono tests cover anonymous access, denied/allowed roles, asynchronous policies, and
fresh role changes. SQLite/native HTTP checks use two accounts, confirm owner-scoped
lists and deletion, grant/remove a role through trusted database code, and verify
that both server processes see the changes. See `pnpm test:auth`.
