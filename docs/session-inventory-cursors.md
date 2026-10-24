# Session inventory pages and cursors

Owner: SessionInventory codec plus the native store keyset. Connects
[API](session-inventory.md), [schema/index](session-inventory-schema.md),
[HTTP](session-inventory-http.md) and [browser lifetime](console-session-inventory.md).

Rows sort by (expires_at,session_id), ascending. The composite index begins with
user_id for exact owner filtering; an exclusive tuple predicate continues after
the last visible row. Each query uses a bounded limit+1 lookahead. Public dates
are exact safe-integer epoch milliseconds. References are lowercase hex with
binary/C ordering, never token hashes. Numbered browser labels reflect display
order, not a persistent device name or creation order.

nextCursor is null at the observed end. Otherwise it encodes version 1, the owner,
the initiating public session reference and the last visible expiry/reference.
UTF-8/base64url input is bounded to 2048 characters and has an exact validated
shape. The native store compares both owner and initiator after reauthentication;
using another account's or another sign-in's cursor fails with INVALID_INPUT.
A forged cursor cannot choose an authorization subject or make a foreign query.
The cursor is not a bearer capability or a signed authenticity claim.

Only known position fields are serialized, even if a custom store supplies extra
properties. The JSON exposes no raw token, token hash, password or roles. The owner
ID is the same public account identity already available from authentication;
public references remain non-secret selectors behind fresh authorization.

Pages are live observations. Sessions can expire, be removed or be added between
reads; no repeatable snapshot or complete total is promised. Refresh restarts from
the first page. New sign-in references need not appear in creation order. If the
cookie rotates to another initiating session, start again rather than continuing
its prior cursor. The browser clears stale rows on failed reads and checks every
response against its current page/viewer lifetime.
