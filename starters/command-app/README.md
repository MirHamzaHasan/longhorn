# LongHorn command application

A complete Node/PostgreSQL application with a browser console and a protected,
durable receipt receiver. This distribution contains editable source and its
unpublished framework snapshot; it has no dependency on the original workspace.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

Requires Node 20.19+ and pnpm 12.6.0. PostgreSQL 18 is the verified database;
the local receiver uses pinned Miniflare/workerd with retained disk storage.
The archive includes its resolved dependency lock and keeps the framework local.
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
