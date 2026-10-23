# Native Redis cache verification

Owner: scripts/verify-redis-cache.mjs, redis-sandbox.mjs and portable fixtures.
Connects [provider behavior](redis-cache.md), [transport](redis-node.md),
[serialization](cache-json-codec.md) and [application integration](redis-tasks-example.md).
Local evidence uses Node 20.19.4 and Redis 8.0.0. Full workspace types and 449 source
tests pass. The dedicated Ubuntu job installs its own Redis binary; hosted results
are revision-specific through [release verification](release-verification.md).

```sh
pnpm test:redis-cache
```

The gate requires a Redis 7+ server binary and openssl on PATH. Set
LONGHORN_REDIS_SERVER to another native binary path. It creates a new temporary
configuration/data directory, random password and loopback port. Credentials stay
in a mode-0600 file/environment; no password is passed in server command arguments.
It controls only that process and never starts/stops an existing Redis service.

The shared codec and command protocol execute from built exports on Node, Bun,
Deno and real workerd, with an explicitly fake command client. This tests portable
serialization/key/copy/lifetime behavior, not Workers Redis TCP support. Actual
Redis TCP/TLS ownership is verified separately through the Node adapter.

The actual native server proves exact absolute expiry, undefined/falsy values,
overflow rejection without replacement, shared loads, copy isolation and local
invalidation fences. Namespace clear keeps neighboring/unrelated keys, restricted
ACLs deny flush/foreign reads, malformed values reject and a real Redis process
restart retains cache entries through the fixture's owned AOF storage. User Redis
persistence/replication policy remains deployment-owned.

A TCP proxy withholds a response after a real INCR commits, proving one effect,
capacity rejection, native timeout destruction, actual peer closure, no replay/
reconnect and close draining. A silent authentication peer proves connect bounds.
An owned TLS proxy/certificate proves rejection of untrusted certificates and
successful explicitly trusted CA access. Private failure details are sanitized.

Separate Node HTTP hosts use actual SQLite data and the Redis-backed summary.
The gate verifies cached output across host restart, invalidation after committed
writes, source fallback during outage, successful writes while bypassing cache,
rejected credentials before listening, a signal during startup, malformed cache
fallback and cleanup. Both stdout and stderr structured records are captured;
diagnostics are checked for credentials/cache-content disclosure.

Cleanup releases blocked test loaders, drains cache/connection owners, stops owned
HTTP/Redis processes, disposes workerd, closes proxy sockets and removes only the
generated fixture directories. The CI Redis job additionally runs the existing
memory-cache gate, keeping the optional integration distinct from default behavior.
