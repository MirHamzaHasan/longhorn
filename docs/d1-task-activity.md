# Atomic D1 task activity

Owner: `D1TasksStore` and migration d1-tasks/002 in
[schema.ts](../examples/d1-worker/src/schema.ts). Connects task changes to
retained activity using one [native batch](batch-database.md), without an
in-process event observer or external queue.

Creation inserts a task and its created entry together. Update conditionally
changes the expected revision and assigns a unique mutation token, then inserts
updated activity only from a row carrying that exact token. Deletion first
inserts deleted activity from the expected revision, then deletes the task in
the same batch. If either statement fails, both task and activity changes roll
back. Stale and missing mutations add no activity. Unique mutation and
(task_id,revision) constraints detect duplicate records.

Entries expose position, taskId, revision, kind (created/updated/deleted) and at.
They omit title, payload and private mutation token. A deletion records revision
plus one, so its maximum is 2147483648. History has no task foreign key and remains
readable after deletion. The per-task endpoint can return an empty page for an
unknown UUID and the retained page for a deleted UUID.

Global and per-task endpoints use bounded [keyset pages](d1-pagination.md).
There is no automatic retention job or delivery guarantee to another system.
The example exposes public data and accepts public writes; this activity is not
a protected audit trail or proof of an authenticated actor. Schema/deployment
authority can alter it. Add application authorization and a separate audit
protocol when those properties are required.

[Native verification](d1-testing.md) forces an activity trigger failure and checks
that no task remains, races revision edits through two Worker applications and
compares full retained activity after an actual workerd process restart.
