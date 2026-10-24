# Saved-view transaction ownership

Owner: PostgresHistoryViews writes and configureHistoryViews. Connects
[Idempotency](idempotency.md), [transaction authentication](account-operations.md),
[schema/grants](saved-view-migrations.md) and [verification](saved-view-testing.md).

A fresh write intent enters the existing PostgreSQL Idempotency store, then authenticates
the request token inside that managed transaction. The current principal must
match the admitted account; all-scope create/update also checks current roles.
Database SQL receives only that principal's owner ID. The stored reply commits
with the business write. There are no network calls inside the transaction.

Authentication holds shared ownership sufficient to coordinate with credential/
role/session changes; it does not serialize unrelated writes by one account.
Create therefore acquires pg_advisory_xact_lock(hashtextextended(key,0)), where key
is a fixed saved-view quota namespace plus the authenticated owner. Only then does
a fresh READ COMMITTED statement count the owner's records and insert below 20.
This coordinates hosts/connections. Hash collisions can serialize extra accounts
but do not change ownership. Commit, rollback and process loss release the lock.
Idempotent replay bypasses creation and consumes no additional slot. A cached
replay is an admitted read of the original reply; it does not run the business
authorizer again or execute a new saved-view write.

Updates use owner/id/revision predicates and increment revision atomically, with
a safe-integer ceiling. Deletes use the same owner/revision fence. Database name
uniqueness protects concurrent renames; conflicts roll back the request reply too.
No-op updates first verify the supplied revision, then return the observed record.
Read/list admissions remain live snapshots and do not hold mutation ownership.

Native verification proves two-host last-slot admission, one revision winner,
stale-delete rejection, business constraint failure without a poisoned replay key,
real SIGKILL before write/result commit and retry after rollback. A session revoked
while a request waits for the authentication lock produces no view. Once admitted
under transaction ownership, a write may finish before a later revocation wins;
client cancellation cannot promise to undo a committed mutation.

The browser retains stable keys for unchanged retries after uncertain responses.
Changing intent generates a new key. Navigation drops the form and fences late
announcements, while the server may still commit an admitted write. Refreshing the
personal list reveals actual state. Labels/filter replies use the existing replay
retention and can survive active-record deletion until cleanup or backup expiry.
