# Browser sign-in controls

Owner: the existing Account route in `examples/postgres/console/app.ts`, its CSS
and host-owned `data-session-controls` flag in the fixed public shell. Both members
and operators can open Account, choose End other sessions to keep this browser,
or choose Sign out everywhere to include it. The page does not invent device
names, locations, IPs or session metadata; no session inventory is claimed.

Controls call the real [session API](session-controls-http.md) with strict scope
JSON and the normal HttpOnly cookie. Known success for others reports the actual
live count, including a distinct zero-other result. Known success for all clears
private UI and shows sign-in. Ordinary 401 clears stale private state. Refused
input/origin asks the user to reload. A lost, timed-out or unexpected response is
unconfirmed and leads to sign-in without any automatic retry. Local UI clearing
alone is not proof that the server revoked an otherwise valid cookie.

Session and [password controls](console-account.md) share one pending operation
across navigation. All account action buttons/password fields, Sign out and login/
registration submissions stay disabled until it settles. Starting a session change
clears entered password controls. Reentry renders empty disabled fields and honest
pending feedback. A late success can sign out after navigation; a late result cannot
restore a departed form. Navigation and manual status reads remain available.
A previously cached sign-in form is reconciled after pending state ends.

Public capability flags are host-configured booleans only. A custom host without
session control support renders an unavailable message and no action buttons;
changing DOM flags cannot grant the guarded API capability. Password and session
flags are independent. User text uses textContent; only theme is persisted.
Labels, 48px controls, wrapped actions, persistent status text, focus and both
themes follow the existing [design](console-design.md) and [security](console-security.md).
No new animation or external assets are introduced.

Real browser proof is part of the [account gate](console-account-testing.md):
held native response, password/session mutual exclusion, pending navigation, zero
and nonzero counts, preserved current/unrelated account, all-device sign-out and
a dropped committed response with no replay. The independent archive also uses
both shipped controls after restore/regrant and restart. See
[native proof](session-controls-testing.md), [sessions](sessions.md) and
[feature index](features.md). Physical-device assistive technology and other
browser engines remain separate manual checks.
