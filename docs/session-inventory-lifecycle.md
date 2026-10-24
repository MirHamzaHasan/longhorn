# Session inventory ownership and interruption

Owners: SessionInventory and its borrowed native stores. Connects
[API](session-inventory.md), [HTTP](session-inventory-http.md),
[console lifetime](console-session-inventory.md) and [proof](session-inventory-testing.md).

Construction creates no SQL, listener, timer or connection. The service captures
store methods and its clock, validates/copies options before asynchronous hashing,
and gives a frozen hash-only request to the native store. The native callback
samples time once after ownership; invalid clocks/provider shapes fail closed.

Every operation awaits its actual transaction and commit before returning. A
failure after DELETE but before commit preserves the row; process death after
commit retains deletion even when no reply was received. Repeating an other-session
revocation can return zero while the initiating session remains valid. Repeating
a current-session revocation instead requires a new valid login. There is no
transport retry, forced rollback claim or implicit refund of authentication state.

This service owns no closeable resource. Await SDK calls before closing a borrowed
database. In Longhorn, accepted HTTP work includes hashing/native SQL and drains
before the application's database cleanup. Native browser/API proof holds a real
advisory lock, starts a session read and closes the app; pool release stays pending
until the lock is released and the request finishes.

Browser reads belong to the current page and are aborted/fenced on navigation.
Accepted mutations keep a separate global account-operation lifetime, disable
competing controls and settle even after navigation. Completion clears that state
before sign-in rendering, so current revocation or an uncertain reply cannot leave
a permanently disabled login form. No private row state is persisted in browser
storage or URLs; page disposal clears rows/cursors/listeners.
