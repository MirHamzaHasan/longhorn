# Command delivery and receipt updates

Owner: examples/postgres/console/command-follow.ts and commandPage in app.ts.
Connects [command detail](account-operations.md), [delivery metadata](command-history-delivery.md),
[page ownership](command-follow-lifecycle.md), [browser controls](console-command-follow.md)
and [verification](command-follow-testing.md).

An admitted command detail page with no receipt automatically checks again when
its delivery is pending, running or succeeded. A real receipt, failed delivery or
unavailable metadata ends that run. A command whose metadata is already failed/
unavailable does not start automatically; Follow updates can check it explicitly,
including after an operator starts recovery. A receipt-service error also requires
an explicit retry. Initial receipt reads remain separate from delivery metadata:
the consumer can commit its effect before the publisher receives acknowledgement.

Each cycle reads the existing protected command detail, then its protected receipt.
A receipt 404 means no receipt yet. Empty successful receipt arrays also remain
pending. Other failures stop the loop, preserve the last admitted display and offer
manual refresh or another explicit run. There is no automatic mutation, request
replay, operator recovery, new HTTP endpoint, schema change or general polling
service. Every new read still passes current cookie, viewer and owner/role policy.

Only one cycle may be in flight. The next cycle starts three seconds after the
previous one settles. A run stops after 30 cycles or two minutes of elapsed wall
time, whichever comes first. Every HTTP request retains its existing 15-second
deadline, and the run deadline aborts any current cycle. An explicit new run gets
a fresh budget; ordinary background activity cannot reset it.
Thirty cycles permit at most sixty follow GETs, in addition to the initial view's
detail and receipt reads. Errors or terminal results usually stop sooner.

These are bounded browser reads, not server push or a guarantee that delivery
finishes within the budget. [History lists](command-history-updates.md) now own
separate bounded window updates; outgoing lists, recovery forms and audit pages
retain explicit refresh. No private command state is persisted in browser
storage, and no additional runtime package or database permission is required.
