# Run a saved command again

Owner: `examples/postgres/console/app.ts`, its pure `console/numbers.ts` helper,
and the existing protected command/history APIs. Connects
[history](account-command-history.md), [submission](account-operations.md),
[idempotency](idempotency.md), [receipts](command-application.md) and
[viewer consistency](console-viewer-binding.md).

Open a saved command and choose Run again. The `#/new/COMMAND_UUID` route reads
that command through GET `/account/commands/:id` and shows its numbers in a review
form with a link back to the source. Reloading the route reads the source again.
Review/edit the values, then choose Create command. Opening/reloading the form
does not submit a command. The source UUID is the only extra hash-route data;
numbers, request keys and credentials are never written to URLs or storage.

Saved input must be an actual numeric array satisfying the current 1–100 finite
numbers / ±1 trillion limits. Strings, nulls, sparse/nested arrays, nonfinite,
excessive or out-of-policy values fail closed; they are not coerced or truncated.
The normal form parser is shared with copying. Malformed legacy data shows Cannot
copy this command with a blank-create action. Unavailable/unauthorized sources use
one Original command unavailable state, preserving the existing 404 privacy policy.
Malformed UUID links never select arbitrary API paths.

Submission uses a fresh random request key scoped to the current submitting
account. The body remains only `{id,numbers}`: no source ID, owner, role or delivery
capability is sent. A member can load only admitted owned sources; an operator can
load sources allowed by its current role, but the new command belongs to the
submitting operator. Source read authorization is an admission snapshot; previously
admitted values are not retroactively unread after later role changes. Submission
still uses existing transaction-owned authentication.

| Action | Effect |
| --- | --- |
| Run again, then Create command | New command ID, request key and outgoing delivery; source and original receipt remain unchanged |
| Try again after a lost submission response | Same key/numbers while the review form remains open; an already committed response replays without a second command |
| Edit normalized numbers after an attempt | New request key for the changed submission |
| Operator Retry delivery | Existing delivery's explicit recovery allowance and audit; does not create another command |

Copying is not a server-side lineage relationship or clone endpoint. It copies
numbers admitted at read time and preserves array order. The original row/delivery/
receipt is not changed, even when edited numbers are submitted. Successful copies
appear in ordinary history and use the normal computed-receipt workflow.

Route changes abort earlier source reads; version checks prevent delayed results
from restoring an old review form. Network failures offer manual retry. Leaving
or reloading a submitted form discards its request key, so check history after an
uncertain submission before starting another copy. A browser abort does not cancel
accepted server work. The [viewer fence](console-viewer-binding.md) rejects old
account views if another tab changes the active cookie.

[Native browser proof](command-rerun-testing.md) covers the complete flow, ownership,
actual new receipts, edited/manual replay, malformed source data, loading/navigation,
account switches and the independent restored application. See
[console](web-console.md), [security](console-security.md) and [feature index](features.md).
