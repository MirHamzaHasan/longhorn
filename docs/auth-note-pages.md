# Bounded private-note reads

Owner: `examples/auth/src/notes.ts` and the GET `/notes` route in `app.ts`.
The example's list response is now `{ notes, nextCursor }`; previously it returned
all owned notes in `{ notes }`. Clients that need the whole collection must follow
`nextCursor`. Create/delete routes keep their existing behavior.

```http
GET /notes?limit=20&after=123
```

Authentication runs before query validation. `limit` defaults to 20 and accepts
canonical positive integers 1–100. Optional `after` is a canonical positive signed
int64 decimal string, up to `9223372036854775807`. Leading zeroes, signs, whitespace,
fractions, overflow, unknown keys and duplicate keys return 400. There is no
caller-selectable owner; each request uses the freshly authenticated user ID.

The SQL binds that owner, the optional cursor as bigint and `limit + 1`. It selects
only `id,title`, orders by increasing ID and returns at most `limit` notes. IDs and
the cursor are exact strings; `nextCursor` is the last returned ID when lookahead
exists, otherwise null. A cursor remains useful after its note is deleted and can
refer to an ID absent from the current owner's collection.

The existing `private_notes_owner(owner_id)` index already includes the SQLite
rowid order needed for the owner/cursor query. No migration or original checksum
changes are needed. Pagination is a live view: concurrent writes/deletes can change
later pages, and this API does not claim a multi-request snapshot or total count.

The shared helper also reparses/copies typed input before awaiting SQL and rejects
unsafe numeric IDs or invalid row shapes. All three [native auth hosts](native-auth-example.md)
use this helper. Source tests cover interleaved owners, default/strict pages,
deleted cursors, exact int64 IDs and index use. The [mixed runtime gate](native-password-testing.md)
traverses 1006 Alice notes while excluding 21 Bob notes through each native host,
then checks deleted cursors and the maximum int64 boundary.
