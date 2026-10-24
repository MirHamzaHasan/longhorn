# {{PROJECT_NAME}}

A persistent Node task API using LongHorn HTTP, DI, validation, configuration,
logging, events and caching. Requires Node 20.19+ and pnpm 12.6.0.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm dev
```

Open http://127.0.0.1:3000/health. The app creates checked SQLite schema and keeps
tasks in data/longhorn.sqlite across process/source-watch restarts. Ctrl-C drains
HTTP, event observers and cache loads before closing the database. For a compiled
host, run `pnpm build` then `pnpm start`.

```sh
curl -i http://127.0.0.1:3000/tasks -H 'Content-Type: application/json' \
  -d '{"title":"Build a useful API"}'
curl http://127.0.0.1:3000/tasks
curl http://127.0.0.1:3000/summary
curl http://127.0.0.1:3000/activity
```

Copy .env.example to .env or .env.local for settings; process values win. Relative
DATABASE_PATH resolves from this project for both source and compiled hosts.
`:memory:` explicitly disables persistence. See [configuration](docs/configuration.md).

Tasks persist; activity counters and summary caches are process-local. This public
example has no account authorization, request-key replay or revision checks.
Updates use ordinary last-writer semantics. See [features](docs/features.md) for
each contract and [testing](docs/testing.md) for real persistence verification.

`pnpm test:persistence` builds and exercises separate native hosts, concurrent
writers and SQLite integrity in owned temporary data. Keep .longhorn/ and
pnpm-workspace.yaml with the app; generated code is editable and framework updates
require deliberate review. No production deployment or package publication occurs.
