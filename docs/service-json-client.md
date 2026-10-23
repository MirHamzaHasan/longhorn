# Bounded authenticated JSON client

Owner: createJsonClient from `@longhorn/http/client`. Connects
[HTTP delivery](outbox-http-publisher.md), [remote receipts](operator-receipt-transport.md)
and [runtime portability](runtimes.md). This optional entry imports no Hono or Node APIs.

```ts
const service = createJsonClient({
  baseUrl: 'https://receiver.example/', token: serviceToken,
  timeoutMs: 2000, maxConcurrent: 16,
})
const response = await service.request('health', { signal })
```

The explicit base URL ends in / and contains no credentials, query or fragment.
HTTPS is required; allowInsecureLoopback permits HTTP only for localhost,
127.0.0.1 or [::1]. Request paths stay under that base: leading slashes, dot
segments, URL syntax, percent escapes and queries are rejected. No environment,
ambient cookies, redirects or referrers supply credentials. Every request sends
the configured bearer token and asks for JSON. Redirects are rejected rather
than followed with the service credential.

Defaults are a 5-second deadline, 64 KiB encoded request, 16 KiB response and
16 concurrent calls. Limits are validated; capacity overflow fails immediately.
Request JSON serialization and UTF-8 size are checked before fetch. Responses
require a JSON content type, bounded streamed bytes, valid UTF-8 and valid JSON.
The result contains status/data; callers enforce application schemas/status policy.
Serialization size bounds do not eliminate allocation of the caller's input.

Caller cancellation and deadline abort fetch and response reading. Actual transport
ownership is retained until it settles; an injected fetch that ignores abort can
hold admission beyond the deadline. Custom transports must honor AbortSignal.
There is no internal retry or connection lifecycle; the caller owns accepted
requests and drains them before dependent resources close.

JsonClientError exposes only bounded codes such as timeout, cancelled, network,
protocol and response-too-large. Arbitrary remote diagnostics, URL, token and
body are not copied into errors or logs. Source tests cover escaping, redirects,
byte limits, stalled reads, ignored cancellation and capacity. The
[native gate](persistent-operations-testing.md) uses real TCP on Node/Bun/Deno/workerd.
