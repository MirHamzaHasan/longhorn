# Native metric collector verification

Owner: `scripts/verify-otlp-metrics.mjs`, the shared owned collector helper and
metric fixtures. Connects [encoding](otlp-metrics-json.md),
[delivery](otlp-metrics.md), [reader lifetime](metric-reader.md) and
[the reports host](jobs-metrics-export.md).

```sh
pnpm test:otlp-metrics
```

The gate starts the real pinned OpenTelemetry Collector 0.163.2 with an OTLP/HTTP
JSON metric receiver and JSON forwarding exporter. It inspects normalized points
received by a bounded loopback sink. It does not substitute a fake collector ACK
for protocol interoperability. The helper now retains at most 512 metric points
and 512 spans separately, stops only its child and removes owned temporary data.

Built code runs in native Node 20.19.4, Bun 1.4.4, Deno 2.9.6 and actual workerd
1.20250718.0. All four prove cumulative start/time identity across collections,
increasing counters, signed gauges, Unicode labels, disjoint histogram buckets,
serial point batching, identical-byte transient retry and final reader drain.
Workers explicitly collect/close inside the request lifetime; this does not claim
a guaranteed final flush after arbitrary platform disposal.

A controlled authenticated gateway injects partial/permanent/redirect/oversized
and stalled-header/body responses. Real Fetch proves non-replay classifications,
bounded deadlines and actual peer closure. The compiled SQLite reports host proves
push without a scrape or remote tracing, worker-derived metrics, successful
business work/readiness during collector outage, cumulative recovery and final
observations before graceful process exit. Forwarded data/logs are checked for
test authorization, dynamic job IDs and private query input.

Source tests additionally exercise UTF-8 byte caps, malformed/sparse input,
partial acknowledgement bounds, clock rollback, coalesced flush races, timer
ownership, collection bounds, close-on-failure and an intentionally uncooperative
Fetch. The existing native trace gate passes against the same shared delivery
engine and expanded collector helper.

Local native evidence is macOS ARM64. tooling/otelcol.json pins official macOS ARM64
and Linux x64 archives, both rehashed on each use; Linux's SHA is checked against
the [official release asset](https://github.com/open-telemetry/opentelemetry-collector-releases/releases/tag/v0.163.2).
The Ubuntu telemetry job runs both native trace/metric gates. Hosted execution is
subject to the account's Actions budget; configured pins/jobs alone are not Linux
execution evidence. Other profiles can supply a matching LONGHORN_OTELCOL_BIN.
