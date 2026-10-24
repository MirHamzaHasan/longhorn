# Portable typed native-report client

Owner: createNativeReportComputer in
[examples/jobs/src/native-reports.ts](../examples/jobs/src/native-reports.ts).
It composes [createJsonClient](service-json-client.md), the application report schema
and versioned result validation. This is an application integration module, with
no process spawn, filesystem, native binding or Node-specific import.

```ts
const computer = createNativeReportComputer({ baseUrl, token, timeoutMs: 2000 })
try {
  const report = await computer.compute({ numbers: [3, -1, 9] }, signal)
} finally { await computer.close() }
```

HTTPS is the default transport policy. allowInsecureLoopback explicitly permits
local development HTTP. URL/path/credential, streaming byte limits, redirects,
deadlines and caller cancellation follow the existing JSON client. Fixed limits
are 64 KiB request and 1 KiB response; default admission is 16 calls. maxConcurrent,
timeoutMs and a borrowed Fetch transport are configurable.

Input cardinality is checked before schema work. Schema parsing copies the numbers
before the first await. Results require protocol longhorn.reports.v1, a strict
finite/bounded count/sum/min/max object, matching input count and min no greater
than max. The client validates the wire contract; the selected service owns the
computation. healthy(signal) validates the authenticated health envelope and returns
false on unavailable transport/status or an incompatible health envelope.

close stops new calls and awaits accepted operations until their actual transport
settles, including health probes. Repeated close shares one promise. A transport
that ignores abort retains ownership beyond the configured deadline; no fake drain
releases its slot. stats reports active/accepted/failed calls and closing state.
The client adds no retry. NativeReportError has bounded input, capacity, closed,
unavailable or protocol codes; remote bodies, token, URL and arbitrary causes are
not attached. Consumer code owns logging and retry policy.

The [jobs host](jobs-native-reports.md) registers the selected compute function
through DI and closes the native client after producers/workers/readiness have
drained. The [native gate](rust-reports-testing.md) runs the built client against
the real Rust socket on Node, Bun, Deno and workerd. That portability does not imply
the jobs host's Node SQLite driver runs on all those platforms.
