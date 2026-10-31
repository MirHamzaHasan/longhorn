# Owned Node Redis connection

Implemented with [native TCP/TLS and lifecycle verification](redis-cache-testing.md).

Owner: `openRedis` from `@longhornjs/node/redis`, backed by pinned @redis/client 6.3.0.
Connects the portable [Redis cache protocol](redis-cache.md) to Node TCP/TLS. Its
public command/close interface does not expose native client types to the shared
cache package. The Node root entrypoint does not import this optional adapter.

Configuration requires an explicit rediss URL or opted-in loopback redis URL.
Queries/fragments/path traversal and unsupported database paths are rejected.
TLS uses normal certificate verification; an optional PEM CA supplies explicit
private trust without a skip-verification switch. URL credentials and server
errors never appear in the adapter's error message/cause.

Connect/authentication, command and close deadlines are bounded. Commands are
snapshotted into RESP string arguments with admission/argument-byte limits.
Reconnect, offline queueing, native client-side caching and automatic command
retry are disabled. A command deadline destroys the owned connection and rejects
its outstanding native promises; an idle connection is not timed out merely for
being idle. Closing rejects new work and drains accepted commands before socket
release. Native destruction ends transport ownership; it cannot undo a server
effect committed before a lost acknowledgement. The application chooses recovery.

Errors have stable input/closed/capacity/timeout/connection/command codes. Open a
new connection/cache explicitly after a failed channel. No implicit healthy-memory
fallback is selected by the adapter. The task example's application service owns
its existing authoritative-read fallback policy. See
[node-redis production usage](https://redis.io/docs/latest/develop/clients/nodejs/produsage/).

The same connection also supplies the optional [Redis request limiter](redis-rate-limits.md).
That provider borrows the connection. Its host must drain all limiters before
closing the client, and must not let an independently owned cache close a client
still in use by a limiter. See [ownership](redis-rate-limit-lifecycle.md).
