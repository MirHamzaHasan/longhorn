# HTTP

src/app.ts registers native Hono routes through Longhorn.http. Fetch starts the
application before dispatch. Responses carry request IDs and no-store. JSON/body
validation precedes repository calls; bodies above 16 KiB return 413. Unmatched
routes return 404; storage errors use a generic 503 without SQL/arguments.
See [validation](validation.md), [tasks](tasks.md) and [lifecycle](lifecycle.md).
