# Validation

src/schemas.ts holds Zod title/completion schemas. @longhornjs/validation/hono uses
Standard Schema and native Hono parsing. Titles trim to 1–200 characters and PATCH
requires a boolean completed value. Schema failures return 400 JSON without raw
input. SQL repositories bind values separately from statements; SQL-looking titles
do not execute. See [HTTP](http.md), [tasks](tasks.md) and [SQLite](sqlite.md).
