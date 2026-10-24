# Native Rust report verification

Owner: [verify-rust-reports.mjs](../scripts/verify-rust-reports.mjs) and the locked
Cargo workspace. `pnpm test:rust-service` checks formatting and Rust tests;
`pnpm test:rust-reports` builds TypeScript/Rust then runs the complete native gate.
The workflow's rust-reports job pins Rust 1.97.1 and runs the same commands on Linux.

Rust tests cover finite bounded arithmetic, maximum cardinality, zero normalization,
invalid ranges and ambiguous/unknown JSON fields. Source tests cover request
snapshots, strict response/version/count checks, sanitized remote failures,
capacity, abort-ignoring transport ownership/close, paired configuration and
cancelled job ownership before persistence.

The actual native binary verifies credential/config/bind rejection, versioned
health/results, JSON/body/media bounds, real capacity rejection while a request
body is incomplete, deadline release and subsequent availability. The built client
executes through actual Node/Bun/Deno Fetch and a browser-bundled workerd fixture
against that same Rust socket. No fake native executable or JS runtime adapter is
used as evidence for Rust execution.

Real jobs HTTP proves DI-selected computation, readiness failure during outage,
durable admission, handler retry after the service restarts on its prior port,
computed persistence and retained results after a jobs-host restart. SIGTERM during
an accepted partial body waits for its real response before the Rust process reports
zero active work and exits. The owned demo verifies random credentials, a new
computed report, cleanup order and temporary storage removal. The native development
launcher verifies a locked build and signal forwarding to its authenticated child.

The gate owns all processes, request sockets, workerd storage and demo descendants.
Native logs are inspected for credential leakage before redaction in diagnostic
errors. Limits apply to admitted report handlers, not all possible HTTP connections.
Results establish local single-host computation/transport and existing SQL queue
semantics; remote deployment, CPU speedups, arbitrary native plugins and durable
native side effects need separate designs/proofs. See [protocol](rust-reports.md),
[client](native-report-client.md), [jobs](jobs-native-reports.md) and [demo](rust-reports-demo.md).

## Local evidence

On macOS ARM64 with Rust 1.97.1 and Node 20.19.4, frozen workspace install, the
full TypeScript build/type checks and 519 source tests in 85 files passed. Cargo
format checks and two native Rust tests passed. The actual binary/client/jobs/
demo/launcher gate passed, including all four JavaScript runtimes and the native
completed-computation counter confirming application work executed in Rust.
Existing native queue, scheduler, observability and all three OTLP signal gates
passed. Validation checked 314 Markdown files/2752 local links and preserved the
original LICENSE blob. The eighth CI job is configured; hosted execution remains
separate evidence from this local result.
