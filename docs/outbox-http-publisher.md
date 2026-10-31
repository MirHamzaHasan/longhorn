# Acknowledged HTTP outgoing delivery

Owner: createHttpPublisher from `@longhornjs/outbox/http`. Connects the existing
[Outbox dispatcher](outbox-dispatcher.md), [JSON client](service-json-client.md)
and a compatible [durable receiver](http-message-receiver.md).

```ts
const publisher = createHttpPublisher<NumbersCommand>({
  baseUrl: 'https://receiver.example/', token: configuredSecret,
  timeoutMs: 2000,
})
const dispatcher = outgoing.createDispatcher(publisher)
```

Each publish POSTs {id, topic, data} to messages under the configured base. The
message ID stays unchanged across attempts. Only HTTP 200 with exactly
{id: matchingMessageId, accepted: true} completes delivery. An asynchronous 202,
wrong ID, extra fields, false acceptance or other HTTP status rejects. A compatible
receiver must commit its deduplicated effect before returning this acknowledgement.
The library can validate the protocol response, not inspect a remote service's
implementation or durability policy.

The provider performs one HTTP attempt. Queue retry/backoff, attempt budgets,
lease renewal/fencing and shutdown drain remain owned by Outbox/QueueWorker.
The publisher passes the worker's AbortSignal to the bounded transport. Remote
acceptance followed by a lost response or process crash is ambiguous and can
cause another send with the same ID. Consumers must dedupe; there is no
cross-system commit or general exactly-once promise.

Transport options and limits follow the [JSON client](service-json-client.md).
HttpPublishError contains only http/acknowledgement and an optional status;
remote diagnostics and credentials are not propagated. Network/protocol errors
remain sanitized JsonClientError values. This optional entry adds an HTTP-client
dependency; the root Outbox entry imports no HTTP implementation.

[Native verification](persistent-operations-testing.md) sends built code from all
four runtimes to the actual protected SQL receiver, then kills the persistent
publisher host after remote commit and before acknowledgement. Lease recovery
reuses the original ID and retains one receipt.
