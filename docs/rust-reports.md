# Optional native Rust report service

Owner: [native/rust/reports](../native/rust/reports/src/main.rs). This is a separate
HTTP service, selected by application code through the existing portable JSON
transport. Rust is optional; ordinary TypeScript builds and generated API/SQLite
projects do not compile it. It is not another JavaScript runtime adapter.

```sh
rustup toolchain install 1.97.1 --profile minimal --component rustfmt
pnpm build:rust-reports
LONGHORN_NATIVE_TOKEN=local-development-token-at-least-32-characters pnpm dev:rust-reports
```

The build uses pinned Rust 1.97.1 and the checked-in Cargo.lock. The macOS helper
selects an installed Command Line Tools SDK/linker for its child when available,
preserving explicit SDKROOT/linker settings. The process binds loopback, prints
its actual URL and drains on SIGINT/SIGTERM. `pnpm demo:rust-reports` runs an
[owned working demo](rust-reports-demo.md) with random credentials.

| Native environment | Default / policy |
| --- | --- |
| LONGHORN_NATIVE_TOKEN | Required, 32–256 base64url characters |
| LONGHORN_NATIVE_HOST | 127.0.0.1; only loopback IP addresses |
| LONGHORN_NATIVE_PORT | 3020; 0 chooses an available port |
| LONGHORN_NATIVE_MAX_CONCURRENT | 16 admitted reports; 1–128 |
| LONGHORN_NATIVE_REQUEST_TIMEOUT_MS | 2000; 1–60000 |

Every route requires one exact Bearer credential. Byte comparison uses subtle;
credentials, input numbers and remote diagnostics are not logged. GET /health
returns `{protocol:"longhorn.reports.v1",status:"ok"}`. GET /status exposes bounded
active count, drain state and decimal-string accepted/completed/rejected counters.

POST /v1/reports accepts application/json with one numbers array: 1–1000 finite
float64 values from -1e12 through 1e12. Unknown/duplicate fields and invalid values
reject. The UTF-8 JSON body is capped at 65536 bytes. A successful result contains
the same protocol plus report `{count,sum,min,max}`. Sum follows input order;
results use float64 arithmetic and normalize zero for JSON. There is no decimal
arithmetic or performance benchmark promise. The work is deterministic and pure,
with no native database writes or request ledger.

Auth failure returns 401, invalid input 400, oversized/read-failed bodies 413,
unsupported media/content encoding 415, report-method mismatch 405, unknown paths
404, overload/draining 503 and report deadline 408. Responses use fixed error codes
and no-store. Query strings are rejected. The capacity permit covers body reading,
parsing and computation until response construction. Timeout drops that owned
future and releases its permit. These limits do not cap all HTTP connections or
replace ingress/header policies; the listener is a loopback service.

Shutdown closes admission/listening and awaits entered handlers and their actual
responses through Axum's graceful server. Native computation is bounded synchronous
work within the async handler. There is no detached compute thread or forced-success
timeout. TLS/ingress and independent process deployment remain application-owned.
See [portable client](native-report-client.md), [jobs integration](jobs-native-reports.md),
[native proof](rust-reports-testing.md), [lifecycle-owned host](native-jobs-host.md),
[Axum serving](https://docs.rs/axum/0.8.9/axum/serve/struct.Serve.html) and
[Tokio shutdown](https://tokio.rs/tokio/topics/shutdown).
