# Request replay

POST /tasks optionally accepts Idempotency-Key (1–200 ASCII characters: initial
alphanumeric, then alphanumeric or ._:-). The server fixes scope to
public:d1-tasks:create:v1 and fingerprints the normalized title. Private apps must
derive authenticated scopes; a key grants no authority.

TaskRequests supplies a complete SQL plan and known response to
@longhorn/idempotency/batch-sqlite. Record/task/activity commit together; a duplicate
key fails before business SQL and reads saved JSON. Matching input returns the
original 201/body/Location, even after edits/deletion. Changed eligible input returns
409. Idempotency-Replayed and Idempotency-Expires-At expose replay/deadline policy.

Expiry uses admission time plus configured retention and does not renew on replay.
Expiry/cleanup permits a new generation; no unbounded exactly-once guarantee exists.
The API can recover positive committed evidence after acknowledgement/decoder loss,
but an unavailable read remains ambiguous. No automatic write retry, timer or public
cleanup route is added. Explicit bounded prune preserves business/activity rows.
Without a key, creation is ordinary; PATCH/DELETE still use revisions. See
[configuration](configuration.md), [schema](schema.md) and [testing](testing.md).

Optional [task creation limits](request-limits.md) append the native batch bucket
schema to the complete deployment profile. The budget uses database time and counts
attempts before task validation/replay. A denied request creates no task/activity/
request record; closing drains accepted work before the borrowed D1 handle.
