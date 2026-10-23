# Persistent operator host configuration

Owner: operatorConfigSchema and the `.operator.env` profile in examples/postgres.
Connects [typed configuration](configuration.md), [runtime roles](postgres-roles.md),
[HTTP transport](outbox-http-publisher.md) and [persistent hosting](persistent-operator-host.md).

Copy examples/postgres/.operator.env.example to .operator.env and supply real
runtime/receiver credentials. Optional .operator.env.local overrides it; process
environment has the existing readEnv precedence. Both private profile files are
ignored by version control. The ordinary PostgreSQL .env files are not loaded.

| Setting | Policy/default |
| --- | --- |
| DATABASE_URL | Required existing PostgreSQL runtime TCP URL |
| HOST / PORT | 127.0.0.1 / 3011; port 0 is valid for explicit test/proxy origins |
| LOG_LEVEL / PG_MAX_CONNECTIONS | info / 5, existing bounded pool policy |
| AUTH_ORIGIN | Exact origin, default http://127.0.0.1:3011 |
| AUTH_COOKIE_SECURE | false only for loopback HTTP; true requires HTTPS origin |
| SESSION_TTL_SECONDS | 28800, existing bounded session policy |
| MESSAGE_SERVICE_URL | Required service base ending in /; no credentials/query/fragment |
| MESSAGE_SERVICE_TOKEN | Required 32–256 ASCII token characters; generate a random secret |
| MESSAGE_ALLOW_INSECURE_LOOPBACK | false; explicit true allows loopback HTTP only |
| MESSAGE_HTTP_TIMEOUT_MS | 2000; range 1–60000 |
| DISPATCH_ENABLED | true; false persists commands without starting a dispatcher |

MIGRATION_DATABASE_URL is explicitly rejected in this profile, including an
inherited environment value. Run migrations/provisioning in a separate shell
with their credentials. At database acquisition, the host also rejects superuser,
role/database creation, replication or BYPASSRLS authority, database/schema CREATE,
any other role it can SET ROLE to, user/role mutation capability and audit
UPDATE/DELETE. A nonsuperuser schema owner is therefore rejected too.
These checks supplement the deployment's grants; they are not a universal audit
of all PostgreSQL role memberships or privileges.

Cookie settings and service transport are validated before acquisition. There
is no optional fallback to the temporary broker or in-memory receipts. The host
does not apply migrations, create roles, grant operators or print configuration
values. Configuration failures produce sanitized startup diagnostics. Source
tests cover origin/transport/owner-config rejection; native tests also reject
actual owner credentials and start with the restricted role.
