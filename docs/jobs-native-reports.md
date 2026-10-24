# Rust computation in persistent report jobs

Owner: the existing jobs app, ReportCompute DI token and reportHandler. Connects
[queues](queues.md), [native Rust](rust-reports.md), [typed transport](native-report-client.md),
[diagnostics](jobs-observability.md), database persistence and lifecycle.

The default local report computer retains the existing count/sum/min/max shape.
Configure REPORTS_NATIVE_URL and REPORTS_NATIVE_TOKEN together to choose Rust.
The URL must end in / and follow the service URL policy. Loopback HTTP requires
REPORTS_NATIVE_ALLOW_INSECURE_LOOPBACK=true; REPORTS_NATIVE_TIMEOUT_MS defaults
to 2000 and accepts 1–60000. Incomplete/invalid configuration fails before storage
startup. This external-service mode does not build/start the remote process.
The separate [owned host](native-jobs-host.md) starts a trusted native executable
through the same [async resource contract](report-computer-resources.md).

The existing reports.v1 payload and result table remain unchanged. The worker
receives ReportCompute through DI, awaits computation using the job signal, checks
ownership cancellation again and inserts the result idempotently by stable job ID.
Only validated native output reaches persistence. The application owns an injected
custom reportComputer if supplied; the normal selection owns its native client.
openReportComputer instead acquires an owned compute/health/close resource after
database startup. It cannot be combined with the borrowed function injection.

Acquisition is database, native client, queue/scheduler, workers/runners and
readiness. Cleanup reverses that order: readiness probes and handlers settle before
client close, and the database closes last. The native readiness check calls the
authenticated protocol health route. It reports 503 while the configured service
is unavailable. HTTP queue admission is independent of readiness, so accepted work
can remain durable through an outage.

When selected Rust computation fails, the handler fails and existing queue backoff/
attempt policies apply. There is no implicit local fallback or transport retry.
The pure native computation may repeat after lost acknowledgement or job retry;
the stable job ID guards the database effect. This is not cross-system atomicity
or an exactly-once remote side-effect protocol. Completed results remain readable
after either process restarts. Worker/producer tracing and handler failure metrics
keep their existing explicit-context policy; no distributed native tracing SDK is
added. See [one-command demo](rust-reports-demo.md) and [proof](rust-reports-testing.md).
