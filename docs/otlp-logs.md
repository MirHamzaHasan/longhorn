# OTLP/HTTP log exporter

Owner: `OtlpHttpLogExporter` and `OtlpLogExportError` from
`@longhornjs/observability/otlp-logs`. Connects structural [LogExporter](log-processing.md)
to a collector using portable Fetch and the existing [shared HTTP engine](otlp-delivery.md).
[Encoding](otlp-logs-json.md), [host integration](jobs-logs-export.md) and
[native verification](otlp-logs-testing.md) have separate guides.

```ts
import { BufferedLogProcessor } from '@longhornjs/observability'
import { OtlpHttpLogExporter } from '@longhornjs/observability/otlp-logs'

const exporter = new OtlpHttpLogExporter({
  endpoint: 'https://collector.example/v1/logs', serviceName: 'reports',
  headers: { authorization: serviceCredential },
})
const processor = new BufferedLogProcessor({ exporter })
// Give processor.sink to createLogger; close after all application log producers.
await processor.close()
```

The library reads no environment. Endpoint is an explicit HTTP(S) signal URL,
without URL credentials/query/fragment; no suffix is inferred. Headers/resource
metadata are snapshotted during construction. Requests omit cookies, disable
redirects/cache, and require application/json acknowledgements. HTTPS uses the
host Fetch certificate policy; no insecure TLS switch, certificate-file reader,
Protobuf/gRPC transport or OpenTelemetry SDK is added. parseOtlpHeaders is exported
here too, with the same explicit header format as the other signals.

The exporter owns one bounded active request and no queue. BufferedLogProcessor
owns ordinary batching. Direct overlapping exports reject busy; close stops new
admission, drains the accepted batch and memoizes terminal state. It does not close
the host's global Fetch pool. Native cancellation is proven with actual sockets.
An uncooperative custom Fetch remains quarantined until settling after a deadline;
no additional native transports are admitted behind it.

Log acknowledgements read rejectedLogRecords, independently of span/metric counts.
Partial acceptance is not retried; zero-rejection warnings succeed. Permanent
statuses, redirects, invalid acknowledgements and oversized responses fail without
replay. Network and HTTP 429/502/503/504 failures can retry identical bytes within
the total attempt/deadline budget. A lost acknowledgement remains ambiguous: a
collector may already have accepted logs that the client counts as failed. Retry
can duplicate delivery. No durable downstream storage or exactly-once guarantee
is implied by an acknowledgement.

Defaults: 128 records per batch (1–10000), 16384 normalized bytes per record
(1–1048576), 1 MiB wire request and 64 KiB response, 10000 ms total deadline,
three attempts and 200/2000 ms initial/max retry delays. Shared bounds are listed
in [delivery](otlp-delivery.md); record structure is covered in [encoding](otlp-logs-json.md).

Stats contain active/pending transports, requests/retries, acknowledged accepted /
rejected log records, failed batches, warnings/partial responses and close state.
Errors expose stable codes and optional numeric HTTP/rejection metadata. Neither
includes endpoint, headers, collector diagnostic text, record content or raw cause.
The exporter does not redact arbitrary messages/fields; the logger and application
must choose what may leave the process.
