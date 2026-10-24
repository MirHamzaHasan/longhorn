# Persistent setup

Install and build using the README commands. Provision a PostgreSQL database you
own, a nonsuperuser schema owner and a separate nonsuperuser runtime login such as
`longhorn_app`. Neither login should have CREATEDB, CREATEROLE, REPLICATION or
BYPASSRLS. Make the schema owner own the database. Revoke PUBLIC database access
and public-schema CREATE; grant CONNECT only to intended logins. Passwords and
role creation belong to your database deployment process.

In a separate deployment shell, supply the owner's TCP connection URL through
MIGRATION_DATABASE_URL, then run:

```sh
pnpm migrate
pnpm provision:runtime longhorn_app
```

Grant CONNECT on the database to longhorn_app through your database administrator.
The provisioning command adds the exact application table/function grants in
`src/runtime-grants.ts`. It never creates a login, changes passwords or removes
existing excess privileges. The HTTP host refuses administrative/user-update or
audit-update privileges. Keep the owner connection out of the runtime shell.
Use the complete operations migration profile for every later upgrade.

In the receiver shell, generate a service token and retain its storage directory:

```sh
export RECEIVER_TOKEN="$(openssl rand -hex 32)"
export RECEIVER_DATA_PATH="$PWD/data/receiver"
pnpm receiver
```

The receiver defaults to 127.0.0.1:3012. Keep the token private and supply the
same value to MESSAGE_SERVICE_TOKEN in the app configuration. Retain the directory
across restarts; do not start two local receiver hosts against the same directory.

Copy `.operator.env.example` to `.operator.env`, replace DATABASE_URL with the
restricted runtime connection, replace the service token, then run `pnpm start`
in a shell without MIGRATION_DATABASE_URL. The default console is
http://127.0.0.1:3011/console. The exact AUTH_ORIGIN must match the browser URL.
Loopback development explicitly enables insecure transport/cookies; production
requires the HTTPS settings in deployment.md. Environment values override files.

Register an account in the console. In the separate deployment shell, run
`pnpm operator grant USERNAME` to grant numbers-operator, then sign in again.
Role changes revoke prior sessions. `pnpm operator revoke USERNAME` removes it.
Do not supply deployment credentials to the browser or app shell.

Ctrl+C drains the owned host. It does not remove PostgreSQL or receiver data.
`pnpm dev` builds then watches the Node host; after editing browser/receiver code,
run `pnpm build` and restart the relevant host. There is no unclaimed hot reload.

The complete profile includes [history-filter indexes](history-filters.md). Their
regular transactional builds block writes, so deploy them during stopped-writer
maintenance before starting updated hosts. Startup/readiness checks require both
valid/ready indexes; no new runtime privileges are needed.
