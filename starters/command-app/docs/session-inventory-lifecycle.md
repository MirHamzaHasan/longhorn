# Session reads, changes and page lifetime

[Inventory](session-inventory.md) borrows the normal account database. Its service
hashes the token, captures input and reauthenticates under native ownership before
sampling time. Selected deletion and its result commit together. A lost reply does
not prove rollback; current deletion invalidates its own initiating token.

HTTP drains accepted hashing/native work before pool release. Browser reads belong
to the current Account page; navigation aborts/fences them and clears rows/cursors.
Mutations keep global account-change exclusion until their response settles, even
after navigation. Confirmation/cancel preserve focus; completion clears pending
state before rendering sign-in. Failed reads clear stale rows and offer Refresh.

The expected viewer header prevents a cookie-switched stale page acting under a
different account. Cursors also bind the initiating public reference, so a rotated
cookie restarts pagination. No session data is stored in browser storage or URLs.
The service adds no timer, cleanup, device tracking, password change or future-login
ban. Real-device screen readers remain a manual QA boundary.
