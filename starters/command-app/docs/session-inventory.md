# Active sessions

The Account page lists live sign-ins with expiry and a current-session marker.
Refresh sessions starts again; Load more sessions continues by expiry/reference.
The numbers label display order, not a device or creation time. No IP, location,
browser fingerprint or inferred creation metadata is collected.

GET /account/sessions accepts limit (default 10, 1..50) and cursor. It returns only
{id,expiresAt,current} records and nextCursor. POST /account/sessions/end accepts
strict {id} and returns {revokedSessions:0|1,current}. These public 32-hex references
are not cookie credentials or token hashes. Every operation freshly authorizes
the initiating token under native ownership; cursor scope binds account and sign-in.
Foreign/missing/expired targets all give zero while initiation remains valid.

The UI confirms a selected row and supports Cancel. Other-session success refreshes
the panel; current-session success opens sign-in. Existing others/all controls keep
their route/policy. Unknown committed replies require sign-in rather than automatic
retry. [Lifecycle](session-inventory-lifecycle.md) fences navigation/account changes.
Deploy [the appended schema](session-inventory-schema.md) before upgrading the host.
