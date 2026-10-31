# D1 database

@longhornjs/workers/d1 borrows env.DB through BatchDatabase. Each complete statement
plan is one native atomic batch. There is no async JavaScript callback transaction;
existing callback-based auth/queue stores cannot be substituted here.

Inputs/blobs are copied, admission is bounded and close drains actual accepted
work without deleting platform storage. Unsafe integer results reject; CAST int64
positions to text. Conversion can fail after SQL commits, so a rejected promise
does not prove rollback. Request keys can recover saved responses. See
[schema](schema.md), [pagination](pagination.md) and [idempotency](idempotency.md).
