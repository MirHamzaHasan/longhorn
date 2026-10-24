# {{PROJECT_NAME}}

A LongHorn Workers API with persistent D1 tasks, activity, revision checks and
replayable creation. Editable source and framework exports live in this project.
Requires Node 20.19+ and pnpm 12.6.0 for development tooling.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm dev
```

Open http://127.0.0.1:3000/health. Development builds/watches source, privately
applies checked schema, then starts HTTP. Successful builds restart the owned
host; compilation errors keep the previous host running. Data stays in data/d1
across reload/restart. Ctrl-C stops the watcher and native host.

```sh
curl -i http://127.0.0.1:3000/tasks \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: first-task' \
  -d '{"title":"Ship a working API"}'
curl http://127.0.0.1:3000/tasks
curl http://127.0.0.1:3000/activity
```

Repeat the same key/title for the original 201 response. PATCH/DELETE require the
current revision; stale writes return 409. The dataset is public, without account
authorization. The [feature index](docs/features.md) connects each boundary.

Use `pnpm build && pnpm start` for the compiled local host and `pnpm test:storage`
for actual D1 rollback/replay/restart integration. HOST, PORT (0 allowed),
D1_DATA_PATH, D1_MAX_PENDING and D1_REQUEST_RETENTION_MS use process environment;
this host does not load .env files. See [configuration](docs/configuration.md).

The wrangler.example.toml file is an application-owned binding
template. Only dist/index.js is public; dist/deploy.js needs a trusted private
deployment process. No cloud resources or credentials are created. Local tests
do not establish managed replication/failover. Keep .longhorn/ and
pnpm-workspace.yaml with the app; review snapshot changes deliberately.
