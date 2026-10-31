# Typed cache JSON codec

Implemented with source/type checks and the [built/native gate](redis-cache-testing.md).

Owner: `jsonCacheCodec` and `CacheCodec<T>` from `@longhornjs/cache/json`.
Connects [typed caching](cache.md) and [Redis storage](redis-cache.md) without adding
a schema library to the cache package. Pass an application parser such as
`value => schema.parse(value)` to validate the stored type on writes and reads.
The parser may be synchronous or asynchronous. Encode/decode await validation;
rejections are contained, and an owning Redis store drains that accepted work
before releasing its transport. Custom codecs own their declared T.

The built-in codec stores a versioned envelope, with top-level undefined separate
from a miss or null. JSON data is checked without getters/toJSON/coercion, canonical
object keys are sorted, and invalid/sparse/cyclic/non-JSON shapes reject. The byte
budget includes the envelope (64 KiB default, configurable 16 bytes–1 MiB); depth
is bounded at 32. Schema errors and malformed encoded data become a fixed
CacheCodecError without embedding cache contents.

Validation receives detached JSON data on encoding. Parser output must also be
finite plain JSON or top-level undefined. JSON semantics normalize negative zero
and do not preserve alias identity, prototypes, dates, maps, bigints or nested
undefined. Choose a deliberate custom codec for those types. The Redis value byte
budget is separately enforced; use compatible limits. Memory storage retains its
existing structuredClone behavior and does not acquire a serialization requirement.
The codec itself does not invoke getters; the Cache manager's configured copy
policy still runs before store encoding. Custom parsers/codecs must settle: native
transport deadlines do not force-cancel arbitrary application validation work.
