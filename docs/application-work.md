# Managed application work

Owner: `@longhornjs/core` (`Longhorn.run`), with the portable `TaskApplication`
contract in `@longhornjs/runtime`. Connects [lifecycle](lifecycle.md) to non-HTTP
hosts such as [Worker scheduled events](workers-scheduled.md).

## API and ownership

```ts
const result = await app.run(async () => {
  const service = app.container.resolve(ReportService)
  return await service.generate()
})
// From the host, after it stops accepting work:
await app.close()
```

`ReportService` above is an application-owned token. `run` shares startup with
`start`, `fetch`, and `listen`; it executes the callback only after startup succeeds.
It preserves the callback's value and original rejection. It does not construct
an HTTP request, inject a request logger, or install an implicit async context.
Call it as `app.run(...)` so the application remains the method receiver.

Closing rejects new root work and drains accepted callbacks alongside HTTP
handlers before releasing application resources. A close racing with startup
prevents queued callbacks from entering. Callback failures stay with their callers;
shutdown still attempts every resource cleanup.

Return or await all descendants that use those resources. Detached promises and
separate platform `waitUntil` registrations are not automatically discovered by
core. Never await `app.close()` from a callback it must drain: that waits for itself.
Shutdown belongs to the host, outside managed work.

## Connections and limits

`TaskApplication` requires only `run<T>(work): Promise<T>`. Runtime adapters can
borrow that capability without importing core or an HTTP implementation. The
[scheduled adapter](workers-scheduled.md) adds platform lifetime registration and
[bounded invocation admission](scheduled-invocations.md) around this contract.

Core adds no retries, persistence, concurrency cap, cancellation budget, or process
signal hooks. Those policies remain explicit in the host/adapter. Work that never
settles keeps shutdown pending; a host may impose its own termination policy.

## Verification

[Core work tests](../packages/core/src/work.test.ts) cover shared HTTP/work startup,
values, original errors, late rejection, resource drain, startup failure and
shutdown during startup. [Native scheduled tests](workers-scheduled-testing.md)
also hold real workerd work open while core and adapter close concurrently.
