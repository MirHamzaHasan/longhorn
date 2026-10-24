# Receipt collection lifetime and admission

Owner: receipt-export.ts over [bounded-export.ts](bounded-page-export.md), with
protected readers supplied by console/app.ts. Connects [format](receipt-export-format.md),
[browser ownership](console-receipt-export.md) and [receipt policy](operator-receipt-transport.md).

The wrapper copies the selection before awaiting. History pages use the existing
authenticated owner/operator/status/search query. The shared collector validates
the whole page's command metadata, size, IDs and cursor before starting receipt
reads. It then awaits each command's protected receipt response in order. There is
one read in flight, with the same cancellation/deadline signal for both phases.

Defaults bound a segment to 1,000 commands and ten history pages of at most 100.
The wrapper rejects larger command/page overrides. The ordinary 8 MiB UTF-8 bound,
4 KiB trailer reservation and two-minute total deadline still apply, alongside
each api() request's 15-second deadline. At default bounds a segment admits at
most ten history and 1,000 receipt requests. A direct command admits one fresh
detail read plus one receipt read. Each received page is limited to 100 results.

The entire enriched history page is accepted or excluded at the byte boundary.
A rejected page keeps the previous accepted cursor; its receipt observations may
be read again on explicit continuation. An oversized first page fails. A deadline
aborts the current reader and fails the segment; a late response cannot yield a
file. It does not silently turn timeout into complete output or retry a read.

Every history, command detail and receipt request receives current cookie/viewer
and owner/operator admission. A previously admitted read can finish under its
original admission; subsequent requests recheck. A protected 404 is an observation,
while 401/403, service/network failures and malformed results reject the segment.
Role changes revoke old sessions under existing policy. Cookie switches preserve
the other account's session and stop subsequent stale-view requests.

Navigation, refresh, sign-out, changed filters and changed export contents cancel
the current attempt. Route/subject and export-choice generations fence late
completion and announcements. Changing contents resets the continuation; failure
of an unchanged choice preserves its last successful boundary. Data/cursors stay
in page memory, and Blob URLs are released on timeout-independent page cleanup or
one second after initiation. Earlier saved files remain independent.

On command detail, receipt export and live follow updates have separate readers
registered under the same page disposer. Both stop when the page leaves. Follow
updates never trigger a download, and exporting never starts or restarts follow.
No endpoint, schema, grant, dependency or mutation is added.
