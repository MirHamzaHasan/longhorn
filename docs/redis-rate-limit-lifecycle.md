# Redis limiter ownership and ambiguous replies

Owners: RateLimiter, RedisRateLimitStore and the borrowed command connection.
Connects [coordinator lifetime](rate-limit-lifecycle.md),
[server time](rate-limit-server-clock.md) and [Node transport](redis-node.md).

The limiter admits hashing/store calls before asynchronous work. Close stops new
admission and awaits accepted commands, including provider failures. The store's
active-command budget releases in finally on success, native failure or malformed
reply. It opens/closes no connection. Multiple limiters may share a borrowed store
or connection; keep that connection alive until all their close promises settle.

The host orders acquisition connection -> limiter -> readiness/listener. Shutdown
drains HTTP -> readiness/limiter -> connection. Invalid policy or initial PING
failure rolls back the acquired client. Startup, signal handling and native sockets
remain in the example/Node adapter rather than shared packages.

A command can commit before its reply is lost. Deadline failure destroys the
owned native connection and rejects its outstanding native work; it cannot undo
that Redis write. The limiter returns no successful decision, and Hono responds
with private 503. No retry, reconnect, offline queue, memory fallback, refund or
compensating delete runs. A new explicit connection/host invocation reads the
retained budget; its consume is another attempt.

The native example holds a real post-commit TCP reply, receives SIGTERM while its
HTTP handler is active, and remains alive until the native command timeout settles.
Its 503/exit leaves exactly one committed attempt. A fresh host's denied retry
increments it once. The gate also kills/restarts the owned AOF Redis server and
checks retained windows. See [proof](redis-rate-limit-testing.md).
