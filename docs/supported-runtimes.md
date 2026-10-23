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
| HTTP service client/publisher | All four runtime profiles above | Real TCP to protected receipt receiver; does not imply PostgreSQL on all runtimes |
| Persistent command console host | Node 20.19.4, PostgreSQL 18.4 | Native pg pool, scrypt, complete schema, fixed built assets and restricted role |
| Local durable receiver | Miniflare 3.20250718.3, workerd 1.20250718.0, compatibility date 2025-07-18 | Retained single-host Object SQLite directory; no managed cloud failover evidence |
| Browser console | Playwright 1.64.1 Chromium, axe 4.14.0 | Both themes, desktop/phone widths, keyboard/scaled text; other engines and real-device AT remain manual |
| Offline restore | PostgreSQL 18.4 pg_dump/pg_restore and retained local workerd storage | Stopped writers, fresh database/storage, explicit grants; not online/PITR replication |
| Hosted CI | Ubuntu 24.04, Node/pnpm pinned as above | Source/runtime, account and browser gates executed; current PR checks/logs govern distribution/restore and exact-head results |

The command application distribution is deliberately the Node/PostgreSQL profile.
The framework's four runtime adapters remain modular; that does not make native
Node scrypt or PostgreSQL imports valid in Workers/Bun/Deno hosts. Dedicated
SQLite/Object and other feature gates document their provider scope separately
through the [feature index](features.md). No packages have been published or
production services deployed by this milestone.
