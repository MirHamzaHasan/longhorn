# Lifecycle-owned Rust report resource

Owner: [openOwnedNativeReports](../examples/jobs/src/owned-native-reports.ts).
This Node application module composes [owned processes](managed-node-process.md)
with the unchanged [portable report client](native-report-client.md). It implements
the jobs app's [async computation resource](report-computer-resources.md).

The caller selects an absolute trusted executable. The resource generates a fresh
32-byte credential and starts the service with only that token, loopback host
127.0.0.1 and an ephemeral port. It does not inherit parent variables, database
credentials or service settings. The child cwd is its executable directory.
Application data is still owned by SQLite in the Node host.

Startup requires the Rust ready message, protocol longhorn.reports.v1 and an
HTTP 127.0.0.1 address with an explicit port and no credentials/query/hash/path.
It then creates the typed client with explicit loopback HTTP permission and probes
the authenticated versioned health response. An incompatible or unavailable probe
closes both client and acquired child before acquisition rejects. Parser/startup
errors similarly wait for direct-child cleanup. No token is exposed on the result.

Options include executable, startup signal, startupTimeoutMs, shutdownTimeoutMs and
client timeoutMs (2000 by default). The process startup budget ends at its ready
line; the subsequent health probe has the client deadline and the same caller
signal. The probe remains owned until transport settles. The return value adds
pid, baseUrl and exited for host diagnostics alongside compute, healthy and close.

compute rejects unavailable when the child is no longer running; healthy returns
false. The resource does not restart a failed child. Existing queue retry/backoff
keeps uncompleted work durable for a later host restart. No local fallback or
duplicate native side-effect protocol is introduced: reports are pure, and the
Node handler owns the stable-ID SQL result insert.

Repeated close shares one promise. It first drains the client, then terminates
and joins the child, attempting both releases even if one fails. Unexpected child
exit or forced termination remains a cleanup error; multiple failures are
aggregated. The [host](native-jobs-host.md) supplies parent signal handling and
releases this resource after workers/readiness drain. Parent SIGKILL, machine loss
and arbitrary descendant supervision remain outside this direct-child contract.
See [native service](rust-reports.md) and [actual-process proof](managed-process-testing.md).
