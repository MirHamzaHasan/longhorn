# Asynchronous report computation resources

Owner: [createJobsApp](../examples/jobs/src/app.ts) and
[ReportComputerResource](../examples/jobs/src/reports.ts). The jobs application
can acquire computation during startup through openReportComputer(), returning
compute(input, signal), healthy(signal?) and close(). This is an application
contract; shared core and the queue remain independent of processes and Rust.

```ts
const app = createJobsApp(config, {
  openDatabase,
  openReportComputer: () => openOwnedNativeReports({ executable }),
})
```

The factory runs after database acquisition/migrations and before queues,
schedulers, workers and readiness start. ReportCompute cannot resolve before
acquisition; it throws instead of caching a fallback. Report handlers continue
to receive the same portable function. A failed factory must release its own
partially acquired resources before rejecting; the app then rolls back storage.

Cleanup joins readiness/HTTP/background work, then queue/scheduler resources, then
the computation resource, then the database. This keeps accepted report calls
inside the compute/SQL lifetime. Tests hold an actual queue handler open while
closing and prove computation/storage release waits for it.

The existing reportComputer injection borrows a function from its caller. It
cannot be combined with openReportComputer. Without either injection, configured
external native computation now acquires its client through the same async
factory; otherwise the existing local function is used. External mode readiness
still reports service outages rather than making transport availability a startup
requirement. The [owned implementation](owned-native-reports.md) additionally
requires a successful authenticated startup health probe.

The factory's healthy function supplies dependency readiness. A failed probe does
not delete queued jobs or select local computation. Retry policy and durable
effects remain in the existing [jobs integration](jobs-native-reports.md).
See [resource tests](../examples/jobs/src/report-resource.test.ts),
[lifecycle](lifecycle.md) and [native host proof](managed-process-testing.md).
