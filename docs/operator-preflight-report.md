# Preflight report version 1

Owner: OperatorPreflightReport/OperatorCheckResult in operator-preflight.ts.
Connects [command](operator-preflight.md), [lifetime](operator-preflight-lifecycle.md)
and [verification](operator-preflight-testing.md).

The single native stdout record has schemaVersion=1, ready, cancelled and checks.
After valid configuration, capabilities contains only dispatchEnabled and
requestCleanupEnabled booleans. It contains no URL, user/database name, token,
exception, SQL text, provider row, file contents or stack. The report and its rows
are frozen copies. Normal runtime configuration errors follow this same envelope.
Direct executable loading still requires an installed, built application.

| Check ID | Passing observation | Failure hint points to |
| --- | --- | --- |
| configuration | Existing typed runtime profile loaded | Runtime values and separate owner shell |
| console-assets | Existing console script/style can be read | Build and output files |
| database | PostgreSQL provider acquired and SELECT 1 settled | Runtime connectivity/provider settings |
| schema | Same runtime-visible startup/readiness checks pass | Complete owner profile and runtime grants |
| runtime-role | Existing excess-authority checks pass | Dedicated restricted runtime role |
| receiver | Existing protected health contract returns exactly healthy | Credential, transport and receiver storage |
| database-close | Acquired database close resolved | Resource-owner cleanup |

Status is passed, failed, skipped or cancelled. A failure includes a fixed hint;
provider-supplied details are never copied into it. Inspect IDs rather than error
strings. Missing configuration skips all dependent work. Database failure skips
schema/role, and failed schema skips the role query that requires those objects.
Assets, database and receiver can report independent failures in one invocation.

An interrupted admitted phase is cancelled after settlement; later phases are
skipped. A phase not admitted before cancellation is skipped. Pool close still
runs and reports its actual result. ready is true only with no interruption and
every check passed; a close failure cannot leave ready=true. No success is cached
for another invocation. Custom application/compiler logging has its own policy.
