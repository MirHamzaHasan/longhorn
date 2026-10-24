# Native session control verification

Owner: `scripts/verify-session-controls.mjs`, source/native cases and the browser/
independent project gates. Run `pnpm test:session-controls` after installation.

The source suite verifies explicit opt-in/custom-store compatibility, bound frozen
hash-only input, format/scope checks before storage, zero-other versus invalid-all
counts, stale initiation, invalid clocks and propagated commit failure. Native Node
SQLite cases use real storage for preserved peers/credentials/expired rows, trigger
rollback, copied input and expiry after actual same-file admission. Strict HTTP
source cases reject anonymous/origin/owner injection and check real cookie behavior.

The owned PostgreSQL sandbox runs six cases with a restricted runtime role:

- Live scoped counts/current/peer preservation and exact existing function grants;
  direct user/session UPDATE denial and readiness failure after EXECUTE revocation.
- Reciprocal concurrent other-session revocation admits one winner; the stale
  initiator loses without a deadlock or further deletion.
- An observed real user-row lock wait crosses initiating expiry before deletion.
- A real in-flight login holds shared advisory ownership; after it commits, the
  waiting control sees and revokes its new session.
- A password replacement holds exclusive ownership and wins first; the waiting
  session control rejects the now-invalid initiation.
- Actual trigger failure rolls deletion back; a nonconforming repeatable-read
  adapter is rejected before mutation.

Separate actual Node/Bun/Deno SQLite processes verify both scopes, live counts,
peer/credential preservation, native trigger errors and same-file wait expiry.
For each SQLite runtime and PostgreSQL, the gate then kills an owned process with
SIGKILL after actual deletion and before native commit. Fresh connections observe
all original rows, including the initiating session, after recovery. Fault hooks
wrap the real transaction; no successful storage response is fabricated. Native
storage fixtures use explicit test credentials, not a production password hasher.

`node scripts/verify-auth.mjs bun` additionally uses actual native scrypt and mixed
Node/Bun/Deno HTTP hosts to verify cross-host scoped revocation, retained initiating
and peer sessions, password changes and restart. The independently packed sqlite-auth
gate runs all eight copied application cases on each selected native test runner.

`pnpm test:console` runs actual Chromium/native PostgreSQL/scrypt scopes alongside
password controls. Its [account capture guide](console-account-testing.md) records
screenshots/accessibility boundaries. `pnpm test:command-app` uses the relocated,
frozen-installed archive after offline restore/regrant and retained restart, then
clicks both shipped sign-out controls, verifies current-browser history and operator
isolation, and checks all-device cookie clearing.

CI wires the native gate into account-operations and the browser behavior into the
existing browser job. Local passes do not imply hosted execution/artifacts; inspect
[release evidence](release-verification.md) for the exact source revision. See
[service](session-controls.md), [SQLite](sqlite-session-controls.md),
[PostgreSQL](postgres-session-controls.md), [HTTP](session-controls-http.md) and
[browser](console-session-controls.md).
