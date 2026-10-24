# Cleanup admission, observation and shutdown

Owner: IdempotencyCleanup. Connects [public API](idempotency-cleanup.md),
[application lifecycle](lifecycle.md), [host wiring](request-cleanup-host.md)
and [verification](request-cleanup-testing.md).

The owner moves idle → running → closing → closed. Closing an idle owner is valid;
starting after either close or a previous start fails. Repeated close calls share
one promise, including its failure. start() installs loop ownership before calling
a custom pruner, so a synchronous request to close cannot escape the admitted run.
If close wins before the initial microtask, no prune starts.

There is one admitted prune at a time. A settled run schedules one wait; a long
query shifts the next run instead of building missed ticks. close changes admission
state first, wakes any idle wait and awaits the existing run and observer. The SQL
port provides no cancellation operation. A blocked database query therefore keeps
shutdown pending until actual settlement; closing the pool early is unsafe.

A provider error increments errors, awaits optional onError(error), then permits
another run after the interval. It does not by itself reject close. An observer
failure increments observerErrors and retains its first thrown value; the loop can
continue, but close rejects that value after draining and reaching closed. Handle
the returned close promise through the resource owner. The operator's observer logs
a fixed warning without copying provider details or private request data.

Observers belong to this same lifetime. They must settle; do not await cleanup.close()
from inside a prune or its observer, because close waits for that callback. An
external owner may request close while either is active. There is no detached
retry, unowned promise or forced timeout that claims unsettled SQL has finished.

Register database startup first and cleanup startup afterwards. Longhorn stops
HTTP admission and drains requests, then releases startup resources in reverse
order. The account host drains cleanup before its outgoing services and pool.
Its native proof holds a real PostgreSQL table lock, observes a blocked prune and
checks that neither close nor pool release completes before that lock is released.
