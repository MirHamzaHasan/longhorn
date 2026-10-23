# Idempotency JSON snapshots and fingerprints

Owner: `packages/idempotency/src/json.ts` and Idempotency.run. Connects the
[request API](idempotency.md), [record schema](idempotency-storage.md) and
[HTTP validation](idempotency-http.md).

Inputs are snapshotted synchronously before the first await, so later mutation
cannot change the fingerprint. Object keys sort recursively; array order is
significant. Finite JSON numbers use JavaScript JSON number encoding, including
normalizing negative zero to zero. Text is exact, with no Unicode normalization.
The UTF-8 snapshot is hashed with portable Web Crypto SHA-256 to 64 lowercase hex
characters. This is LongHorn's JSON representation, not a promise of cross-language
canonical-number compatibility. All participating producer hosts must use the
same normalization/version. Validate/trim domain input before calling run.

The serializer rejects undefined, bigint, non-finite numbers, functions, custom
object prototypes, dates/maps, symbol properties, accessors, cyclic references and
sparse/extended enumerable arrays. It does not invoke getters or toJSON. Plain
objects and null-prototype objects are supported; literal __proto__ keys remain
data. Repeated references that are not ancestors serialize as repeated JSON values.
Depth is bounded at 32. Byte limits include JSON punctuation/escaping and UTF-8
bytes, rather than JavaScript character length.

Callback results pass through the same serializer inside the transaction. The
saved JSON is parsed for both the first caller and replays, giving the same value
and property order without sharing mutable result references. Invalid or oversized
results roll back business/job/request writes. Public generic types require
JsonValue; runtime validation also covers untyped JavaScript callers.

A saved response is historical: a pending JobInfo stays pending in replay even if
the live job succeeded, and later task edits do not change the saved task. Follow
the task/report Location to query current state. Version scopes when changing the
response contract; a TypeScript generic cannot validate an older deployment's
saved response shape. The fingerprint is not encryption or a secret authenticator.
Inputs are not stored by the built-in ledger; returned JSON can contain domain
data and needs the same storage/authorization policy as that data.

[Source tests](../packages/idempotency/src/idempotency.test.ts) prove strict
serialization, mutation isolation, key order, bounds and fingerprint stability.
[Native tests](idempotency-testing.md) prove HTTP normalization and persisted replay.
