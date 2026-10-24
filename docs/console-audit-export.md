# Browser recovery audit downloads

Owner: auditExportControls and shared fileExportControls in console/app.ts.
Connects [recovery screens](console-recovery.md), [export format](recovery-audit-export-format.md),
[shared collector](bounded-page-export.md) and [verification](recovery-audit-export-testing.md).

Recovery audit shows Export audit and a one-line field description, including in
the empty state. The delivery route scopes both list and export. Show all recovery
actions opens a fresh global control. Members see Operator access required; the
server independently denies their audit requests.

Preparation uses sequential /account/operations/audit?limit=100 requests with the
captured deliveryId and accepted after cursor. Existing api() supplies same-origin
cookies, displayed-viewer headers, no-store, cancellation and a request deadline.
Progress reports accepted recovery-action counts on page one and every tenth page.
There is no percentage or invented total.

Cancel export aborts the attempt and initiates no file. Navigation, refresh, scope
change and sign-out dispose page work. Version/hash/subject checks fence late reads
and final download. A later authorization failure clears private UI through the
existing account path. Audit Load more errors also check page ownership before
announcing, so a canceled old list cannot announce on the next screen.

Success initiates a temporary local Blob download and reports its record count.
The URL is revoked after one second or page cleanup. Export ready describes download
initiation, not confirmation of an operating-system save. A bounded segment offers
Continue export with its exact last accepted cursor and Start over from the oldest
matching action. Failure preserves the previous successful continuation for an
explicit retry. All continuation/data stays in page memory; reload starts over.

Shared controls preserve focus, use guarded aria-disabled buttons and a polite
atomic status region. Focused Cancel stays in the DOM when the attempt settles;
Start over returns focus to Export audit. Existing kit styles wrap at phone widths,
support both themes and 130% text, and add no motion. Files contain private actor
metadata, so the operator chooses where to keep them. No file is sent to a service.
