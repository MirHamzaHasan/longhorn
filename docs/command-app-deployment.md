# Command application deployment profile

Owner: `starters/command-app/docs/setup.md`, deployment.md and
`examples/postgres/src/runtime-grants.ts`. Connects
[distribution](command-app-distribution.md), [host configuration](operator-host-configuration.md),
[roles](postgres-roles.md) and [operator provisioning](operator-provisioning.md).

The archive provides build/start/receiver/migrate/operator/provision:runtime
scripts. Migration and role tools run only from a separate deployment shell with
MIGRATION_DATABASE_URL. The runtime-only profile has DATABASE_URL, exact browser
origin, secure-cookie mode and explicit protected receiver settings. Receiver
storage and PostgreSQL have separate retained lifetimes. See the archive's
README/setup guide for executable commands.

grantOperatorRuntime(database,role) accepts a bounded simple PostgreSQL identifier,
rejects reserved pg_ names and administrative roles, and adds the existing
application's exact schema/table/sequence/function grants in one transaction.
It does not create logins, assign passwords or remove previous excess grants.
Database CONNECT and role/database creation remain administrator-owned. Runtime
user UPDATE, audit UPDATE/DELETE, migration-history access and queue maintenance
DELETE are excluded. The HTTP host checks actual effective authority on startup.

The host additionally rejects BYPASSRLS, database/schema CREATE and any other role
it can SET ROLE to, including membership whose privileges are not automatically
inherited. Native distribution tests prove rejection before listening. This is
a strict dedicated-runtime-role profile, not an RLS or arbitrary role graph audit.
See [PostgreSQL role inquiry](https://www.postgresql.org/docs/18/functions-info.html).

Production ingress needs HTTPS, AUTH_COOKIE_SECURE=true, the exact external
AUTH_ORIGIN, an HTTPS receiver base and insecure-loopback transport disabled.
Preserve browser Origin rather than rewriting it to pass the guard. Keep metrics,
readiness, database and receiver private. Allow only console assets and /account/
at public app ingress unless deliberately exposing the composed public task/report
example APIs. The archive records this allowlist and single-host receiver limits;
it does not install certificates or claim managed cloud deployment/failover.

For upgrades and retained state use [upgrade procedure](command-app-upgrades.md)
and [offline backup](command-app-backup.md). External infrastructure/secrets are
explicit deployment responsibilities, with no hidden owner credentials in HTTP.
