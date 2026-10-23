# Protected remote receipts and dependency readiness

Owner: createOperationTransport in examples/postgres. Connects
[account operations](account-operations.md), [JSON transport](service-json-client.md),
[receiver](http-message-receiver.md) and [readiness](health-checks.md).

The persistent host constructs an optional HTTP publisher, protected receipt
reader and health check from one explicit receiver configuration. Publisher
and reader own separate bounded client admission. DISPATCH_ENABLED=false omits
the publisher while retaining reads and health checks.

The account command route checks the owner or numbers-operator role in SQL before
calling the reader. The request's AbortSignal reaches the remote fetch. It sends
only the receiver capability, never the browser cookie or user's session token.
A receiver 404 becomes a local Receipt not found response. A 200 must match the
strict receipt-page schema: UUID message IDs and finite count/sum/min/max values,
at most 100 results. Invalid schema, transport/protocol errors and other statuses
become a sanitized 503. Remote headers, Set-Cookie, diagnostics and arbitrary
body fields never pass into the account response.

Account middleware retains no-store/Vary: Cookie. Unauthorized members receive
the existing 404 ownership result before any remote lookup. Admission snapshots
still govern reads; this does not retroactively cancel one after role revocation.
The service capability itself spans this deployment's receipt dataset and is
kept in the server configuration.

The optional message-service readiness check passes the readiness signal to GET
health and requires exactly {ready:true} with HTTP 200. Unavailable/misconfigured
receivers make /readyz unhealthy while /livez remains process liveness. Database
readiness remains a separate check. Startup can succeed during receiver outage:
commands remain durable, while delivery follows its bounded attempt policy and
may need deliberate operator recovery after exhaustion.

HTTP/application shutdown retains ownership of accepted readers and dispatches
before database release. Native tests prove outage/readiness, sanitized failures,
credential rotation, protected persisted receipts and subsequent recovery. No
remote health result is used as authorization for a user command.
