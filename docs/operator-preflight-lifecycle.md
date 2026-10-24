# Preflight acquisition, interruption and script ownership

Owner: checkOperatorApplication and the operator-check native executable.
Connects [report](operator-preflight-report.md), [shared checks](postgres-application-readiness.md),
[CLI ownership](cli-owned-scripts.md) and [native proof](operator-preflight-testing.md).

The app-local API accepts loadConfiguration, loadAssets, openDatabase and an optional
AbortSignal. Load configuration through the existing validated schema. openDatabase
must provide a lifetime owned by this invocation; preflight closes it on every
path after acquisition, including first-query failure. A factory that rejects
before returning must release its own partial acquisition, as the native adapter
does. Existing live-app pools are borrowed by their own owner and should not be
handed to this closing factory contract.

Each admitted phase settles before the next. Dependent work is skipped when a
prerequisite fails; independent probes can still diagnose their own failures.
Configuration is acquired before assets, connections or transport work. The
receiver gets the same AbortSignal as the invocation and uses existing HTTP
timeout/body/authentication policy. SQL uses existing provider connection, lock
and statement deadlines rather than an invented Promise timeout.

SIGINT/SIGTERM stops later admission, but cannot cancel an arbitrary admitted SQL
promise. A connection arriving during interruption is still closed; a held query
or asynchronous close keeps exit pending until real settlement. Close is awaited
even when earlier probes fail. A rejected close is a failed report observation.
No detached callback or fake timeout claims the resource already finished.

The native executable emits the final report after cleanup, with exit 130 for
SIGINT or 143 for SIGTERM. Repeated requests coalesce through one AbortController.
The installed CLI starts the unchanged command-app check script directly when no
precheck/postcheck hooks exist, forwards one signal and waits for actual exit.
Customized/hooked checks and checks on other profiles use normal pnpm delegation.
No check script is silently added to the generic runtime/task/auth templates.
