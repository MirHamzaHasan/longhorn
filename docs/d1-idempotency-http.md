# Replayable D1 task creation

Owner: TaskRequests DI provider, D1TasksStore.createIdempotent and POST /tasks in
[the D1 app](d1-tasks.md). Connects validated input, [batch plans](batch-idempotency.md),
[records](batch-idempotency-storage.md) and atomic task/activity SQL.

```sh
pnpm dev:d1
curl -i http://127.0.0.1:3016/tasks \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: task-create-123' \
  -d '{"title":"Retry this request safely"}'
# Repeat the same key and normalized title to retrieve the original response.
```

| Response | Meaning |
| --- | --- |
| 201, Idempotency-Replayed: false | New task/activity/request record committed, including own-generation recovery |
| 201, Idempotency-Replayed: true | Saved task response; no new task/activity |
| Location | Original task URL on creation and replay |
| Idempotency-Expires-At | Original replay deadline in epoch milliseconds |
| 409 | Same eligible key, different normalized title |
| 400 | Invalid body/key |
| 503 | Storage/record unavailable; keep the key when retrying an ambiguous outcome |

Keys accept 1–200 ASCII characters: initial alphanumeric, then alphanumeric or
`._:-`. Empty, space/comma-containing and overlong keys fail. Titles are trimmed
and validated before hashing, so whitespace variants replay. Scope is fixed to
public:d1-tasks:create:v1. This public dataset has no per-user authorization;
private integrations must derive a principal/tenant scope. These headers/statuses
are application policy, not a standards-conformance claim.

Without a key, creation makes no request record. PATCH/DELETE retain revision
checks without request-key replay. Replay returns the original creation snapshot
even after live edits or deletion. Follow Location for current state; replay does
not recreate a deleted task.

TaskRequests borrows TaskDatabase through DI; Tasks receives both. The repository
generates a UUID/timestamps and validates the proposed Task before supplying task/
activity INSERTs and that exact JSON response. The native batch commits all three.
External effects and callback transactions are outside this plan.

D1_REQUEST_RETENTION_MS defaults to 86400000 (allowed 1–2592000000). The Worker and
local host use the same schema; invalid configuration precedes retained storage.
Retention follows the batch admission clock and is not renewed on replay. No
public prune endpoint or timer is added. [Upgrade](d1-idempotency-upgrades.md)
before serving this code; see [dropped-response/restart proof](d1-idempotency-testing.md).
