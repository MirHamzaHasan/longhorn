# Supported and verified runtime profiles

This matrix describes executed compatibility evidence rather than assuming every
package/provider works on every JavaScript runtime. The local verification host
is macOS ARM64 with Node 20.19.4 and pnpm 12.6.0. Hosted Ubuntu 24.04 evidence
is linked through [release verification](release-verification.md); source/runtime,
account and browser jobs passed there. Package engines allow Node
20.19+, but other Node versions/OS combinations need their own gate execution.

| Profile | Locally verified versions | Boundary |
| --- | --- | --- |
| Shared Fetch/core/DI/validation/config/logging | Node 20.19.4, Bun 1.4.4, Deno 2.9.6, workerd 1.20250718.0 | Shared packages and native/generic starter gates; runtime-specific entries remain explicit |
| Generic CLI starters | All four runtime profiles above | Generated/relocated install, types/tests/build, native start/watch/shutdown |
| Native passwords and retained auth | Node 20.19.4, Bun 1.4.4, Deno 2.9.6 on macOS ARM64 | Independent raw crypto/legacy/peer scrypt vectors, actual SIGTERM drain, same-file accounts/sessions/current roles and bounded private-note HTTP; [native proof](native-password-testing.md) |
| Password replacement and login fencing | Same three native SQLite profiles; Node/PostgreSQL 18.4 with READ COMMITTED | Stale-verifier/concurrent mutation rejection, actual lock-wait expiry, SQL/SIGKILL rollback, active KDF drain, retained cross-host revocation and isolation denial; [proof](password-change-testing.md) |
| Independent native auth projects | Same three native profiles plus Node/pnpm tooling | Packed/relocated/frozen selected snapshots, seven native app cases, retained HTTP/password/session checks and owned development; [project gate](auth-starter-testing.md) |
| Node SQLite task starter | Node 20.19.4, native libSQL SQLite on macOS ARM64 | Packed/frozen relocated install, real two-process HTTP, retained task/integrity, environment/source-watch/schema checks; activity/cache stay local |
| Native Bun SQLite/task starter | Bun 1.4.4 on macOS ARM64 | Native callback ownership, packed/frozen relocated app, bun:test, retained HTTP and owned reloads; see [Bun storage](bun-sqlite.md) and [project proof](bun-sqlite-starter-testing.md) |
| Native Deno SQLite/tasks | Deno 2.9.6, built-in SQLite 3.53.2 on macOS ARM64 | Exact binding slots/int64, callback ownership, permission/crash/lock tests and retained task HTTP; Node/Bun native file interoperability; [proof](deno-sqlite-testing.md) |
| Independent Deno SQLite project | Same Deno profile plus Node 20.19.4 tooling | Packed/frozen relocated app, 47 native cases, native process/persistence, configured permission denial/cleanup and owned reloads; [project proof](deno-sqlite-starter-testing.md); named permissions currently experimental in pinned Deno |
| Bounded SQLite task reads/counts | Node/Bun native profiles above | Exact int64 pages, retained index upgrade, 1029-task traversal/filter/aggregate proof in both installed projects; [read proof](sqlite-task-read-upgrades.md) |
| D1 CLI starter | Node 20.19.4 tooling, pinned Miniflare/workerd above | Packed CLI, relocated fresh/frozen install, real retained task/replay HTTP, source-watch failure/recovery, schema/config denial and shutdown |
| OTLP trace, metric and log HTTP | All four runtime profiles above, native Collector 0.163.2 on macOS ARM64 | Actual collector JSON normalization, Fetch retries/deadlines, buffered log overload and native peer closure; Worker flush stays in the request lifetime |
| HTTP service client/publisher | All four runtime profiles above | Real TCP to protected receipt receiver; does not imply PostgreSQL on all runtimes |
| Native Rust report service | Rust 1.97.1/Axum 0.8.9/Tokio 1.51.0 on macOS ARM64 | Locked native binary, bounded authenticated loopback HTTP and signal drain; [proof](rust-reports-testing.md) |
| Typed native report client | All four JavaScript runtime profiles above | Actual Node/Bun/Deno/workerd Fetch to Rust; jobs integration remains its Node SQLite host |
| Managed executable / owned Rust jobs | Node 20.19.4, Rust 1.97.1 on macOS ARM64 | Actual direct-child abort/output/exit, startup probe/bind rollback and retained HTTP recovery; [proof](managed-process-testing.md); Windows/Linux execution tracked separately |
| Redis codec/provider protocol | All four runtime profiles above | Built exports with a fake command client, including real workerd; no non-Node Redis TCP claim |
| Native Redis task cache | Node 20.19.4, Redis 8.0.0, @redis/client 6.3.0 | Actual authenticated standalone server, TLS proxy, expiry/ACL/restart, native deadline destruction and HTTP outage fallback |
| Redis request limits | Node 20.19.4 / native Redis 8.0.0; Node/Bun/Deno/finite workerd portable protocol | Real Lua/TCP/HTTP, TTL, ACL, SIGKILL/AOF and lost-reply drain on Node; other runtimes use an explicit fake command client; [proof](redis-rate-limit-testing.md) |
| Request attempt limits | Node 20.19.4, Bun 1.4.4 and Deno 2.9.6 native SQLite; Node/PostgreSQL 18.4; finite workerd memory/Hono | Concurrent counters, post-lock clock, capacity/policy bounds, native SIGKILL, two-host HTTP and retained artifacts; [proof](rate-limit-testing.md) |
| Operator preflight | Node 20.19.4, PostgreSQL 18.4 and local protected workerd receiver on macOS ARM64 | Actual artifact/installed CLI, native role/grant/schema/timeout and interrupted SQL drain with private fixed output; [proof](operator-preflight-testing.md) |
| Command source development | Node 20.19.4/esbuild on macOS ARM64, PostgreSQL 18.4 and retained local workerd | Recursive paired source, real active SQL/HTTP drain, receiver reload, profiles, signals and forced-stop failure; [proof](command-development-testing.md) |
| Installed command CLI project | Node 20.19.4/pnpm 12.6.0, PostgreSQL 18.4 and local workerd on macOS ARM64 | Packed/relocated creation, real CLI start/stop, native accounts/receipt/browser/restore and exact source; [proof](command-project-testing.md) |
| Persistent command console host | Node 20.19.4, PostgreSQL 18.4 | Native pg pool, scrypt, complete schema, fixed built assets and restricted role |
| Local durable receiver | Miniflare 3.20250718.3, workerd 1.20250718.0, compatibility date 2025-07-18 | Retained single-host Object SQLite directory; no managed cloud failover evidence |
| D1 provider and persistent tasks | Same pinned Miniflare/workerd, each worker at compatibility date 2025-07-18 | Actual local batches, guarded schema, revision/activity atomicity, numeric/int64 pages, replay after dropped HTTP reply and retained restart; no cloud replication/failover evidence |
| Browser console | Playwright 1.64.1 Chromium, axe 4.14.0 | Both themes, desktop/phone widths, keyboard/scaled text; other engines and real-device AT remain manual |
| Offline restore | PostgreSQL 18.4 pg_dump/pg_restore and retained local workerd storage | Stopped writers, fresh database/storage, explicit grants; not online/PITR replication |
| Hosted CI baseline | Ubuntu 24.04, Node/pnpm pinned as above | Four v0.1 paths executed, including restore; artifact quota limits downloads |
| Hosted CI Redis revision | Five jobs configured on Ubuntu 24.04 | Actions budget rejected every job before runner allocation; no Ubuntu execution evidence for this revision; current PR checks/logs govern exact-head results |
| Hosted verification configuration | Eight jobs including native Rust, D1 storage and native telemetry, pinned Linux x64 Collector 0.163.2 | Rust/tool versions and archive checksum are pinned; an available runner and successful exact-head execution are still required |
| Hosted D1 revision | Seven jobs configured on Ubuntu 24.04 | First run rejected before any runner/step by the Actions budget; no Ubuntu D1 execution evidence; current PR checks govern the current head |

The command application distribution is deliberately the Node/PostgreSQL profile.
The framework's four runtime adapters remain modular. Bun/Deno passwords have their
own verified native entries; there is no Worker scrypt provider or non-Node
PostgreSQL claim from this work. Dedicated
SQLite/Object and other feature gates document their provider scope separately
through the [feature index](features.md). No packages have been published or
production services deployed by this milestone.
