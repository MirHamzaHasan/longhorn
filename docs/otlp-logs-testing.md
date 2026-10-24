# Native log collector verification

Owner: `scripts/verify-otlp-logs.mjs`, log fixtures and the shared owned collector.
Connects [buffering](log-processing.md), [encoding](otlp-logs-json.md),
[delivery](otlp-logs.md) and [reports](jobs-logs-export.md).

```sh
pnpm test:otlp-logs
```

Built logger/processor/exporter code runs on Node 20.19.4, Bun 1.4.4, Deno 2.9.6
and actual workerd 1.20250718.0. The pinned native Collector 0.163.2 receives
OTLP/HTTP JSON logs and forwards normalized JSON into an owned loopback sink.
All four verify severity numbers/text, exact event/observed nanoseconds, nested
typed values, Unicode, logger redaction, explicit/missing trace context,
identical-byte transient retry and final drain inside the supported lifetime.

An authenticated gateway injects partial/permanent/redirect/oversized responses
and stalled headers/body. Actual Fetch cancellation closes peers. Another request
reaches the real collector before its acknowledgement is withheld, proving that
timeout cannot imply non-delivery. A held real export verifies that active work
consumes the count/byte budget and only bounded later records are admitted.

The compiled SQLite reports host verifies simultaneous local output and remote
metadata projection, correlation to actual spans, successful persisted jobs and
readiness during collector outage, local-only failure diagnostics, later recovery
and final Application stopped reception before exit. Forwarded data is checked
for test authorization, dynamic job IDs and private query input.

Source tests add record/byte overflow, snapshot mutation, malformed/accessor/sparse
input, exact UTF-8 wire limits, recursive-feedback containment, safe close failures
and an intentionally uncooperative custom Fetch. Existing trace/metric gates verify
their unchanged signal behavior against the expanded collector helper.

The helper retains at most 512 logs, 512 spans and 512 metric points separately.
It owns only its temporary collector, configs and loopback sinks. macOS ARM64 has
local native evidence; Linux x64 uses the existing checksum-pinned archive in the
Ubuntu telemetry job, whose actual hosted result depends on runner availability.
The account's Actions budget has blocked earlier revisions before startup; a
configured job alone is not hosted execution evidence. Workers final delivery is
verified inside a request, not after arbitrary platform disposal. No durable
remote retention, production throughput or cloud failover is claimed.
