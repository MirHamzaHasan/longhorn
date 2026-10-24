# LongHorn D1 tasks

A persistent Workers API using the existing Longhorn Fetch, DI, configuration,
validation and lifecycle architecture. Native D1 batches commit task changes and
activity together. Each connection has a guide in [the feature index](../../docs/features.md).

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev:d1
```

The local host reports its actual URL, normally http://127.0.0.1:3016. It privately
applies checked migrations, removes deployment authority, then verifies readiness.
Data is retained in examples/d1-worker/data/d1. D1_DATA_PATH changes the directory;
HOST/PORT change the listener, and D1_MAX_PENDING accepts 1–64 (default 6).
Stop with Ctrl-C and restart to keep tasks/activity. See [deployment](../../docs/d1-deployment.md).

```sh
curl http://127.0.0.1:3016/health
curl -i http://127.0.0.1:3016/tasks \
  -H 'Content-Type: application/json' -d '{"title":"Ship the D1 example"}'

# Copy the task UUID from the response.
TASK_ID='replace-with-returned-uuid'
curl -X PATCH "http://127.0.0.1:3016/tasks/$TASK_ID" \
  -H 'Content-Type: application/json' -d '{"revision":1,"completed":true}'
curl "http://127.0.0.1:3016/tasks?limit=20&after=0"
curl "http://127.0.0.1:3016/tasks/$TASK_ID/activity"
curl -i -X DELETE "http://127.0.0.1:3016/tasks/$TASK_ID" \
  -H 'Content-Type: application/json' -d '{"revision":2}'
curl http://127.0.0.1:3016/activity
```

Stale revisions return 409/currentRevision. Pagination cursors are decimal strings
and remain exact beyond JavaScript's safe integer range. Activity survives deletion.
This example is public and has no per-user authorization. A lost reply can follow
a committed write; without a key, retrying creation can create another task.

For replayable creation, repeat the same key and normalized title:

```sh
curl -i http://127.0.0.1:3016/tasks \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: d1-task-123' \
  -d '{"title":"Create this task once within retention"}'
```

Creation/replay return 201 with the original body/Location. Idempotency-Replayed
distinguishes them; changed input under the same eligible key returns 409.
D1_REQUEST_RETENTION_MS defaults to 24 hours (1 ms–30 days). Replay keeps the
original snapshot even after edits/deletion. See [request replay](../../docs/d1-idempotency-http.md),
[upgrade](../../docs/d1-idempotency-upgrades.md) and [native proof](../../docs/d1-idempotency-testing.md).
`pnpm test:d1-idempotency` runs that gate.

The [binding config](wrangler.example.toml) is an explicit application template.
It creates no cloud resources. Only dist/index.js is the public app; deploy.ts
requires a private owner-controlled deployment workflow and must not be published
as an administration endpoint. Remote deployment remains application-owned.

Run `pnpm test:d1` for actual local D1 rollback, migrations, concurrent HTTP edits,
wide cursors, retained restart and host cleanup. See [provider](../../docs/workers-d1.md),
[schema](../../docs/batch-migrations.md), [tasks](../../docs/d1-tasks.md),
[activity](../../docs/d1-task-activity.md), [pages](../../docs/d1-pagination.md)
and [native proof](../../docs/d1-testing.md).
