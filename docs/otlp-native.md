# Native OTLP interoperability and demo tooling

Owner: scripts/verify-otlp.mjs, otel-collector.mjs, demo-tracing.mjs and OTLP fixtures.
Connects [the exporter](otlp-http.md), [encoding](otlp-json.md), [delivery](otlp-delivery.md)
and [report integration](jobs-otlp.md).

pnpm test:otlp builds then starts a real OpenTelemetry Collector 0.163.2. Its native
OTLP/HTTP JSON receiver forwards through the collector's own JSON exporter into an
owned loopback sink. The gate inspects normalized forwarded records, not just a mock
HTTP 200. Node, Bun, Deno and actual workerd execute built exporter code and prove
IDs/parents, timestamp strings, numeric enums, resources/scopes, typed scalar values,
transient retry, original business-error preservation and final drain.

A controlled gateway requires the supplied test authorization header, rejects cookie
leakage, and introduces transient/permanent/partial/redirect/oversized/stalled
responses. Real Fetch tests prove retry classification, body limits and deadlines.
The compiled reports host verifies real persisted work alongside remote server/
producer/consumer spans. It flushes successful work before fault injection, then
proves an outage affects telemetry counters without making readiness/business work
fail. Exported records and process logs are checked for private input/credentials.

Regular tests cover strict admission, mutation isolation, UTF-8 request limits,
response/protocol validation, Retry-After, warning/partial counts, bounded close and
an intentionally uncooperative custom Fetch. Its timed-out request keeps admission
busy until settled, avoiding an unbounded collection of orphan transports.

tooling/otelcol.json pins the official collector release and the macOS ARM64 archive
SHA-256. First use downloads that archive into node_modules/.cache/longhorn, verifies
its checksum, and caches only the archive. Each run rechecks the checksum and extracts
the known executable into its own temporary directory. Downloads are size/deadline
bounded. The manifest source is the [official release](https://github.com/open-telemetry/opentelemetry-collector-releases/releases/tag/v0.163.2).
The helper checks version and binds owned dynamic loopback ports. It does not alter
system services, accounts, libraries or platform security.

Only darwin-arm64 has a default pinned archive and native proof here. Other platforms
can supply LONGHORN_OTELCOL_BIN pointing to a working matching-version collector and
must run their own gate. The helper isolates each collector process, caps retained
sink snapshots at 512 spans and stops only its owned child. Finally blocks remove
owned configs/binaries/sinks; the verified archive stays cached for later runs.

pnpm demo:tracing uses the same collector with a temporary report database. Startup
signals cancel initialization, while normal shutdown drains the host before collector
release. Neither command promises durable backend storage, production throughput,
remote TLS credentials, multi-hop exactly-once delivery or a final Workers isolate
flush outside its supported request/platform lifetime.
