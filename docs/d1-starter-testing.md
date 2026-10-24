# Independent D1 starter verification

Owner: scripts/verify-d1-project.mjs and the generated tests/storage.mjs.
Connects [template selection](d1-starter.md), [assets](d1-starter-snapshot.md),
[development lifetime](d1-starter-development.md) and [D1 replay](d1-idempotency-http.md).

```sh
pnpm test:d1-project
```

The gate generates through the workspace CLI, packs CLI/create-longhorn archives,
installs them into a separate consumer and generates through the installed binary.
The resulting project moves to a path containing spaces before fresh installation.
A frozen install keeps its lock bytes. Installed CLI scripts typecheck/test/build
the project; its actual source matches the D1 example and its dependency graph
contains only independent local framework copies.

The shipped storage test uses owned temporary actual D1 databases. It proves private
schema deployment, six cross-worker request keys with one winner, revision
conflicts, numeric pages and retained task/activity/result after workerd restart.
It never modifies the generated project's normal data directory.

The gate also starts actual compiled hosts through the installed CLI, creates and
updates tasks over HTTP, stops/restarts and replays the original response. Development
testing writes invalid TypeScript, waits for the failed-build record and verifies
the previous host still serves. Saving valid edited source reloads with retained
tasks/replay; shutdown releases the watcher/listener. Invalid settings create no
data directory. Changed applied schema stops readiness/development; restoring the
original source still reads retained data.

Unit tests reject incompatible profiles, malformed/corrupt/escaping assets and
partial output, while default API project tests retain their four-runtime coverage.
The complete source suite passes 505 tests in 84 files, with frozen installation,
workspace build/types and all four generic starter gates passing locally.
The configured D1 CI job runs this gate after provider/replay checks. Local evidence
is macOS ARM64, Node 20.19.4, pinned Miniflare/workerd. Hosted availability and
exact-head results remain separate; prior revisions were rejected before runner
allocation by the Actions budget. No managed cloud deployment/failover or Windows
execution is inferred from these local tests.

[Draft PR #7](https://github.com/MirHamzaHasan/longhorn/pull/7) records review.
Its [first hosted run](https://github.com/MirHamzaHasan/longhorn/actions/runs/40048149813)
failed all seven jobs before runner allocation or an executed step. The D1
annotation identifies the Actions budget restriction; local success does not
substitute for a current-head Ubuntu run.
