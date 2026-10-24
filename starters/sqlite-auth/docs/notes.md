# Owner-scoped private-note pages

Owner: `src/notes.ts` and the authenticated routes in `src/app.ts`.
GET `/notes?limit=20&after=123` returns `{ notes, nextCursor }`. The default limit
is 20, maximum 100. Follow the last returned cursor until it is null to traverse
the whole collection. IDs/cursors are exact decimal strings.

Authentication precedes query validation. Cursors must be canonical positive
signed int64 values, up to `9223372036854775807`. Leading zeroes, signs, fractions,
unknown keys, duplicate keys and caller-supplied owners return 400. SQL binds the
fresh user ID, optional bigint cursor and `limit + 1`, selects only ID/title and
orders by increasing ID. The existing owner index provides rowid order.

POST `/notes` validates/trims a 1–200-character title and assigns the authenticated
owner. DELETE `/notes/:id` includes that owner in SQL. A deleted or absent cursor
still works as an ID boundary. Pages are live views: concurrent writes/deletes
can change later results. This API does not provide a multi-request snapshot or
total count. See [migrations](migrations.md) and [testing](testing.md).
