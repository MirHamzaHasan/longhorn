# Deployment boundaries

The independently verified profile is a Node host, PostgreSQL 18 and local
workerd receipt storage. Retain both PostgreSQL and RECEIVER_DATA_PATH on durable
volumes; do not treat an ephemeral container filesystem as retained storage.
The local receiver is a development/single-host path. Managed cloud failover,
replication and multi-host receiver ownership are not verified by this artifact.

Set AUTH_ORIGIN to the exact external HTTPS origin, AUTH_COOKIE_SECURE=true,
MESSAGE_SERVICE_URL to the receiver's HTTPS base ending in `/`, and
MESSAGE_ALLOW_INSECURE_LOOPBACK=false. Keep the random receiver capability in a
secret store and out of browser assets. Terminate TLS at your trusted ingress,
forward original methods/paths and preserve the browser Origin header. Do not
rewrite Origin to make an untrusted request pass the account guard. Keep the
Node listener and receiver private behind that ingress; never expose PostgreSQL
or deployment credentials through it.

Expose `/console`, `/console/`, `/console/app.js`, `/console/app.css` and
`/account/` through the application ingress. Restrict `/metrics` and readiness
to your monitoring network. The composed example also has public task/report
demonstration APIs; deny other paths at production ingress unless deliberately
using them. The receiver ingress exposes only its existing bearer-protected
health/messages/receipts interface, with no public static source directory.
This artifact contains no automatic deployment or ingress credential changes.

Run migrations and runtime grants from a separate owner shell before starting
the app. Schedule the history migration in a maintenance window because it
rewrites retained history positions under DDL locks. Never shorten/edit a deployed
migration prefix. Keep the old artifact and backups when upgrading; app rollback
does not imply a supported reverse schema migration. Stop writers and take a
consistent PostgreSQL and receiver backup before schema/configuration upgrades.
Use the matching PostgreSQL major-version tools for dump/restore and test restore
in an isolated deployment before replacing service state. Receiver directory
copies must be taken only after cleanly stopping the local receiver.

The native distribution gate installs, typechecks, tests and builds a relocated
archive, deploys its actual migration/grants, uses real PostgreSQL and receipt
storage, verifies account/recovery policy, restarts both processes and checks for
workspace paths. Cloud deployment, TLS certificates and real-device assistive
technology remain deployment/manual verification work.

Preserve `X-LongHorn-Viewer` unchanged when proxying `/account` requests from the
console. This optional [displayed-account check](viewer-binding.md) prevents stale tabs
from silently acting under a newly switched cookie; it grants no identity or role.

[Expired replay cleanup](request-cleanup.md) is optional and uses existing runtime
ledger privileges. Enable it explicitly per host; it adds no schema migration.

Expired command budgets can be reclaimed through the separate
[maintenance tool](limit-maintenance.md). Provision its [dedicated role](limit-maintenance-role.md),
keep its .maintenance.env private, then use `pnpm maintain:limits check`,
`pnpm maintain:limits once` or `pnpm maintain:limits watch`. The HTTP runtime keeps
its existing grants and does not acquire this identity.
