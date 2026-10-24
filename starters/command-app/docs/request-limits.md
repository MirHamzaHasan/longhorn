# Command request limits

Command submission limits are optional and disabled by default. Enable the runtime
profile after running the owner migration and provision:runtime commands:

```dotenv
COMMAND_LIMIT_ENABLED=true
COMMAND_LIMIT_REQUESTS=60
COMMAND_LIMIT_WINDOW_MS=60000
```

The policy counts authenticated POST /account/commands attempts per account across
sessions and hosts. Global body size, origin and authentication guards run first;
invalid command JSON, conflicts and stable-key retries consume attempts afterward.
Reads, sign-in and other mutations retain their existing behavior. Login throttling
remains a separate authentication budget. Changing sessions does not reset this one.

A window begins at the first admitted attempt. A denied request returns 429 and
Retry-After in whole seconds, with no command, outgoing delivery or replay record.
A storage or live policy mismatch returns a generic 503. Keep the same policy and
synchronized clocks on every host. Policy changes take effect for each account
when its current window expires; changing scope explicitly starts a new budget.
The budget commits before the business transaction and is not refunded on failure.
A stable-key retry after the window opens still returns the original stored result.

The owner appends longhorn_rate_limit/001_buckets after the existing operations
profile. Runtime needs schema USAGE and table SELECT/INSERT/UPDATE. It receives
no bucket DELETE or schema CREATE. Preflight, startup and /readyz check the required
access only when enabled. The preflight capability is commandLimitsEnabled.
Backup/restore preserves bucket state alongside history, sessions and replays.

Expired buckets reset on their next attempt. There is no automatic cleanup timer.
A separately trusted maintenance process can use RateLimiter.prune(limit) with a
PostgresRateLimitStore and DELETE authority; pruning is table-wide, bounded to
1..10000 expired rows and never removes live windows. Do not grant maintenance
DELETE to the runtime host. Subject hashes are deterministic, scoped pseudonyms;
they are not encryption and are not anonymous against guessing.

See [setup](setup.md), [schema](schema.md), [preflight](preflight.md),
[commands](commands.md) and [backup](backup.md).
