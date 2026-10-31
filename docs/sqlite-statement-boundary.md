# Shared SQLite statement boundary

Owner: optional `@longhornjs/database/sqlite-statement`, used by
[Bun SQLite](bun-sqlite.md), [Deno SQLite](deno-sqlite.md) and [Workers D1](workers-d1.md). The helper
`assertSqliteStatement(sql)` checks statement boundaries without a native import.
It is the former D1 scanner moved intact into the shared database package;
`runtimes/workers/src/d1-sql.ts` preserves D1's internal function name.

Native Bun prepare accepts the first statement and ignores trailing SQL. The
provider rejects extra SQL before native execution, so an accepted-looking plan
cannot silently execute only its prefix. The scanner accepts comments, quoted
strings/identifiers, semicolons inside quotes and one optional trailing semicolon.
CREATE [TEMP/TEMPORARY] TRIGGER retains its body statements and CASE/END expressions
as one statement. Qualified NEW.end and NEW.case are not mistaken for body controls.
Tokens after a complete trigger or terminated statement reject.

BEGIN, START, COMMIT, END, ROLLBACK, ABORT, SAVEPOINT and RELEASE cannot be the first
keyword. The native provider owns transaction lifetime. Each caller still owns
SQL byte/text limits, input snapshots, error mapping and actual preparation; the
scanner is deliberately conservative and does not parse all SQLite grammar.

This is a boundary check for trusted application SQL. It does not authorize tables,
restrict PRAGMAs or provide a sandbox for arbitrary user SQL. Other SQLite adapters
retain their own documented policy; importing this helper does not change them.
Actual trigger effects and rejected-prefix writes are verified by the
[Bun native tests](../runtimes/bun/test/sqlite.test.mjs); existing D1 source and
[native D1 checks](d1-testing.md) protect the extracted scanner's previous behavior.
