# Active session API

GET /auth/sessions returns this authenticated owner's live {id,expiresAt,current}
records and nextCursor. limit defaults 10 (1..50); cursor continues by expiry and
public reference and binds both account and initiating sign-in. POST /auth/sessions/end
accepts strict {id} and returns {revokedSessions:0|1,current}; current deletion also
clears the cookie. Existing others/all controls remain at /auth/sessions/revoke.

References are independent public 32-hex selectors, not bearer tokens or token
hashes. Cookie/origin/body validation and native reauthentication protect operations.
Foreign/missing/expired targets uniformly return zero while initiation remains
valid. No device/IP/creation metadata is collected or inferred. No command changes
passwords, extends TTL or bans future logins.

Startup appends longhorn_auth/002_session_inventory after the complete old notes
profile. A native SQLite backfill/AFTER INSERT trigger creates references for old
and later unchanged session writers. Unique/paging indexes support bounded reads;
GET performs no initialization writes. A failed suffix rolls back fully. Keep
complete manifests together when upgrading; an old migrator may reject newer history.
Await accepted service calls before database release. A lost committed deletion
reply is ambiguous, so sign in to check instead of blindly retrying.
