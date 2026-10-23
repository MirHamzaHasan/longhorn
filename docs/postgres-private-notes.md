# PostgreSQL private notes

Owner: PostgresPrivateNotes in examples/postgres/src/private-notes.ts and account
route guards in accounts.ts. Connects [authenticated principals](postgres-accounts.md),
[credential identities](auth-postgres.md), [cursor pages](postgres-pagination.md),
validation and lifecycle-owned database access.

longhorn_pg_example.private_notes contains bigint identity ID, owner_id referencing
longhorn_auth.users with ON DELETE CASCADE, and a nonempty trimmed title limited to
200 characters. The (owner_id,id) index supports scoped traversal. IDs become exact
decimal strings before JSON. Titles/IDs/principal values are bound parameters.

Every list, lookup and delete query includes owner_id from c.get('auth').user.id.
Create derives the owner from that same principal. There is no body/query parameter
for choosing an owner. The write schema rejects additional fields. Cross-account
GET/DELETE return the same 404 as a missing ID. Unauthenticated routes return 401.
These checks live above SQL in the application's authenticated route boundary.

GET /account/notes returns {notes,nextCursor}. Its ascending-ID keyset page defaults
to 20 and permits limits 1–100; optional after must be a positive signed int64 string.
It fetches one extra row to detect another page. GET /account/notes/:id reads one,
POST /account/notes returns 201 plus Location, and DELETE returns 204 or 404. No
OFFSET, total count, title editing or cross-request snapshot guarantee is supplied.
Concurrent changes can affect later pages.

Runtime needs table SELECT/INSERT/DELETE and identity-sequence USAGE. It has no note
UPDATE grant because no update route exists. Owner deployment creates the FK/index;
auth storage does not migrate domain tables itself. Deleting an account through an
authorized future admin operation cascades its notes and sessions in PostgreSQL.

This is application-enforced ownership, not PostgreSQL row-level security. The
trusted server's database role can access rows across accounts; direct database
credentials are not given to clients. Public tasks and task reports remain a separate
shared dataset and do not become private by adding this account sub-app.

[Native proofs](postgres-auth-testing.md) check scoped reads/deletes, injection-like
titles, cursor bounds, client owner injection, cascades and HTTP persistence across
process restarts.
