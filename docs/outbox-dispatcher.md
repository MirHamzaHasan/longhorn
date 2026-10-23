# Outbox dispatcher ownership and retries

Owner: Outbox.dispatchOnce/createDispatcher and the existing Queue/QueueWorker.
Connects [outgoing API](outbox.md), [queue workers](queue-workers.md),
[lifecycle](lifecycle.md), [lease fencing](queues.md) and [native proof](outbox-testing.md).

```ts
const dispatcher = outgoing.createDispatcher(publisher, {
  concurrency: 2, pollIntervalMs: 250,
  onError: error => logger.error('Outbox dispatcher failed', { error: String(error) }),
})
app.onStart(() => { dispatcher.start(); return () => dispatcher.close() })
```

Acquire database -> Outbox -> dispatcher; release dispatcher -> Outbox -> database
after HTTP/app.run callers drain. start is once-only. snapshot returns existing
worker state/active/error counters. Publisher rejection becomes durable retry/fail
state; onError observes operational errors such as failed SQL claims/acks. Observer
failure is retained and reported at close. A timer host explicitly owns polling;
Fetch platforms instead loop a bounded number of dispatchOnce calls inside an
owned scheduled/alarm invocation. No poller starts from constructing an Outbox.

Claims/leases/fencing/heartbeats and retry delays are the same proven Queue engine.
Defaults are a 30-second lease, 1-second retry delay capped at 60 seconds and three
attempts per record; enqueue options override maxAttempts/delayMs. Exponential
backoff is capped. Invalid stored payload is terminal. A crashed running record
recovers after lease expiry; exhausting the final attempt becomes failed.

The native worker supports concurrency 1–64 and pollIntervalMs 1–2,147,483,647.
Its loops yield after bounded busy work. dispatchOnce handles one record; a platform
host chooses batch size/budget and awaits each actual publisher operation. The
Object example uses the existing SQL alarm host with a batch limit of ten and
includes pending/retry/lease deadlines in native wakeup planning.

Heartbeat loss aborts the publisher context cooperatively. A late/stale publisher
cannot acknowledge a newer lease. Remote systems still require deduplication: a
fencing token in SQL cannot undo a remote acceptance. The publisher must await its
real operation even if cancellation is ignored. Dispatcher/Outbox close joins that
operation rather than releasing resources while it continues. The Workers adapter
checks cancellation before and after its uncancellable binding send.

The state transition after acceptance is a separate SQL acknowledgement. An
interruption in between leaves a leased row for recovery and duplicate sending
with the same id. Consumers dedupe that ID in their own effect transaction. Failed
records remain inspectable with get or [bounded list](outbox-inspection.md) until
explicit retention cleanup. [retryFailed](outbox-deliberate-retry.md) now permits
an authorized caller to grant more lifetime budget without changing the ID or
resetting attempts; the same dispatcher processes the resulting pending record.
