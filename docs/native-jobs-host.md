# Persistent jobs host with owned Rust computation

Owner: [native-index.ts](../examples/jobs/src/native-index.ts) and
[serve-native-jobs.mjs](../scripts/serve-native-jobs.mjs). Run from this checkout:

```sh
rustup toolchain install 1.97.1 --profile minimal --component rustfmt
pnpm dev:jobs-native
curl -i http://127.0.0.1:3002/reports \
  -H 'Content-Type: application/json' -d '{"numbers":[3,-1,9]}'
```

Follow the returned report Location. The existing API stores jobs/results in
examples/jobs/data/jobs.sqlite by default and retains them after restart. It also
exposes schedules, /readyz and the existing diagnostics. The launcher builds
TypeScript and locked Rust, then starts this Node host. The host acquires its
SQLite connection and [owned Rust resource](owned-native-reports.md) before binding
HTTP. Startup does not announce an API until native protocol/health checks pass.

| Host setting | Policy |
| --- | --- |
| REPORTS_NATIVE_BINARY | Launcher selects the built native binary; an explicit absolute trusted executable skips Cargo |
| REPORTS_PROCESS_STARTUP_TIMEOUT_MS | 5000; 1–60000, through the ready frame |
| REPORTS_PROCESS_SHUTDOWN_TIMEOUT_MS | 10000; 1–60000, before forced termination |
| REPORTS_NATIVE_TIMEOUT_MS | 2000; 1–60000, per client operation including startup health |
| HOST / PORT | Existing API defaults 127.0.0.1 / 3002; PORT=0 is supported |
| DATABASE_PATH | Existing project-relative data/jobs.sqlite; absolute paths or :memory: accepted |
| SHUTDOWN_GRACE_MS | Existing 0–10000 delay after readiness begins draining |

The host reads examples/jobs/.env and .env.local plus its process environment.
The launcher selects/builds Rust from its own environment before the host reads
those files. Set an explicit REPORTS_NATIVE_BINARY on the command when choosing
an independently built binary. External REPORTS_NATIVE_URL/TOKEN mode cannot be
combined with this owned host; use pnpm dev:jobs for a separately managed service.
The child gets its generated token and ephemeral loopback address automatically.

SIGINT/SIGTERM handlers are installed before native acquisition. During startup
they abort acquisition and await rollback; after startup they mark readiness
draining, honor the optional grace, and close the app. App cleanup joins handlers,
workers and health probes before client/child release; storage closes last.
An HTTP bind failure releases the already healthy native process. Repeated signals
share shutdown. The launcher forwards signals and waits for its host to exit.

Unexpected native exit makes readiness return 503 and report attempts fail through
normal queue retry policy. The API can still durably accept jobs. Restarting the
host acquires a fresh service and processes remaining attempts. Shutdown reports
exit status 1 if cleanup discovers an unexpected child failure, and normal shutdown
returns 0. This host owns a trusted direct child during cooperative lifetime;
use an external supervisor for parent crashes and deployment/restart policy.
See [jobs API](jobs-example.md), [DI resource contract](report-computer-resources.md),
[process bounds](managed-node-process.md) and [verification](managed-process-testing.md).
