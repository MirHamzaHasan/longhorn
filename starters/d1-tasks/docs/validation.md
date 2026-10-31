# Validation

src/config.ts keeps Zod schemas beside application input. @longhornjs/validation/hono
uses Standard Schema and Hono parsing. Titles trim to 1–200 characters; IDs are UUIDs;
update/delete revisions are positive int32; unknown JSON fields reject. Invalid
JSON/input returns 400. Cursor syntax is checked before BigInt conversion.
See [HTTP](http.md), [tasks](tasks.md) and [pages](pagination.md).
