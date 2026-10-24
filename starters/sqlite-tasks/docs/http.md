# HTTP

src/app.ts registers Hono routes through Longhorn.http. /health follows successful
startup; /tasks provides CRUD; /summary and /activity expose derived observations.
Core supplies request IDs, JSON 404/500 and correlated request/error logs. A
database failure does not disclose native errors to HTTP clients. Input field
validation is supplied, while ingress body/rate limits remain deployment policy.
See [validation](validation.md), [tasks](tasks.md) and [runtime](runtime.md).
