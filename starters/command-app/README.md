# {{PROJECT_NAME}}

A complete Node/PostgreSQL application with a browser console and a protected,
durable receipt receiver. This distribution contains editable source and its
unpublished framework snapshot; it has no dependency on the original workspace.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Requires Node 20.19+ and pnpm 12.6.0. PostgreSQL 18 is the verified database;
the local receiver uses pinned Miniflare/workerd with retained disk storage.
CLI generation resolves dependencies on the first install; retain the resulting
pnpm-lock.yaml and use --frozen-lockfile for repeat/deployment installs. A packaged
archive already includes its resolved lock and supports a frozen first install.
Both forms keep the framework local. See [generation](docs/generation.md).
See [locked dependencies](docs/dependencies.md) for install and update policy.
Follow [setup](docs/setup.md) to provision separate owner/runtime roles and start
both hosts. Open http://127.0.0.1:3011/console to create an account and submit
`4, 8, 15`. Refresh status to read a receipt with sum 27.

[Feature connections](docs/features.md) explain the source layout,
[recovery](docs/recovery.md) exercises outage and deliberate retry, and
[deployment](docs/deployment.md) records production ingress/storage boundaries.
[Offline backup and restore](docs/backup.md) preserves both retained stores through
a verified maintenance checkpoint.
There are no default accounts, passwords or remotely deployed services.

After setup, use `pnpm dev` for app/console source reloads and `pnpm dev:receiver`
in the separate receiver shell. See [development](docs/development.md).

Use `pnpm check` after build/configuration for a read-only runtime report before
starting the app. See [preflight](docs/preflight.md).

Expired command budgets can be reclaimed through the separate
[maintenance tool](docs/limit-maintenance.md). Provision its [dedicated role](docs/limit-maintenance-role.md),
keep its .maintenance.env private, then use `pnpm maintain:limits check`,
`pnpm maintain:limits once` or `pnpm maintain:limits watch`. The HTTP runtime keeps
its existing grants and does not acquire this identity.
