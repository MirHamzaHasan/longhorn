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
| Node SQLite task starter | Node 20.19.4, native libSQL SQLite on macOS ARM64 | Packed/frozen relocated install, real two-process HTTP, retained task/integrity, environment/source-watch/schema checks; activity/cache stay local |
| D1 CLI starter | Node 20.19.4 tooling, pinned Miniflare/workerd above | Packed CLI, relocated fresh/frozen install, real retained task/replay HTTP, source-watch failure/recovery, schema/config denial and shutdown |
| OTLP trace, metric and log HTTP | All four runtime profiles above, native Collector 0.163.2 on macOS ARM64 | Actual collector JSON normalization, Fetch retries/deadlines, buffered log overload and native peer closure; Worker flush stays in the request lifetime |
| HTTP service client/publisher | All four runtime profiles above | Real TCP to protected receipt receiver; does not imply PostgreSQL on all runtimes |
| Redis codec/provider protocol | All four runtime profiles above | Built exports with a fake command client, including real workerd; no non-Node Redis TCP claim |
| Native Redis task cache | Node 20.19.4, Redis 8.0.0, @redis/client 6.3.0 | Actual authenticated standalone server, TLS proxy, expiry/ACL/restart, native deadline destruction and HTTP outage fallback |
| Persistent command console host | Node 20.19.4, PostgreSQL 18.4 | Native pg pool, scrypt, complete schema, fixed built assets and restricted role |
| Local durable receiver | Miniflare 3.20250718.3, workerd 1.20250718.0, compatibility date 2025-07-18 | Retained single-host Object SQLite directory; no managed cloud failover evidence |
| D1 provider and persistent tasks | Same pinned Miniflare/workerd, each worker at compatibility date 2025-07-18 | Actual local batches, guarded schema, revision/activity atomicity, numeric/int64 pages, replay after dropped HTTP reply and retained restart; no cloud replication/failover evidence |
| Browser console | Playwright 1.64.1 Chromium, axe 4.14.0 | Both themes, desktop/phone widths, keyboard/scaled text; other engines and real-device AT remain manual |
| Offline restore | PostgreSQL 18.4 pg_dump/pg_restore and retained local workerd storage | Stopped writers, fresh database/storage, explicit grants; not online/PITR replication |
| Hosted CI baseline | Ubuntu 24.04, Node/pnpm pinned as above | Four v0.1 paths executed, including restore; artifact quota limits downloads |
| Hosted CI Redis revision | Five jobs configured on Ubuntu 24.04 | Actions budget rejected every job before runner allocation; no Ubuntu execution evidence for this revision; current PR checks/logs govern exact-head results |
| Hosted verification configuration | Seven jobs including D1 storage and native telemetry, pinned Linux x64 Collector 0.163.2 | Linux archive checksum is pinned; an available runner and successful exact-head execution are still required |
| Hosted D1 revision | Seven jobs configured on Ubuntu 24.04 | First run rejected before any runner/step by the Actions budget; no Ubuntu D1 execution evidence; current PR checks govern the current head |

The command application distribution is deliberately the Node/PostgreSQL profile.
The framework's four runtime adapters remain modular; that does not make native
Node scrypt or PostgreSQL imports valid in Workers/Bun/Deno hosts. Dedicated
SQLite/Object and other feature gates document their provider scope separately
through the [feature index](features.md). No packages have been published or
production services deployed by this milestone.
