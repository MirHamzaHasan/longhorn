# Independent application and restore gate

Owner: `scripts/verify-command-app.mjs`. Connects
[distribution](command-app-distribution.md), [deployment](command-app-deployment.md)
and [offline restore](command-app-backup.md).

```sh
pnpm exec playwright install chromium
node scripts/prepare-postgres-clients.mjs
pnpm test:command-app
```

The client preparer downloads PostgreSQL 18.4 from the official source archive,
verifies its pinned SHA-256 and builds only required client tools into a private
temporary directory, recording its path under ignored .artifacts. It never
installs globally or starts/stops a database service. A C toolchain, make and Perl
are needed; alternatively set LONGHORN_PG_CLIENT_BIN to PostgreSQL 18 tools.
The preparer's non-TLS/non-compression build is for this loopback native QA only;
production uses its own appropriately configured PostgreSQL clients.

The gate extracts the actual archive into a temporary relocated folder, scans
for workspace references, verifies the shipped lock hash, frozen-installs in CI
mode without changing lock bytes, then independently typechecks/tests/builds it.
Manifest drift must fail an offline frozen install without rewriting the lock.
It then
starts a new owned native PostgreSQL cluster. The archive's own schema/grant tools
deploy a previously empty database. It validates bad role input, administrative
role denial and startup denial for BYPASSRLS, CREATE and SET ROLE capabilities.

The actual shipped profile, Node host, Chromium client and workerd receiver prove
native login, owned command/history, replay, computed receipt, member/operator
denial, spoof/cross-origin rejection, receiver outage, deliberate recovery, audit
and both processes restarting with retained state. No successful API response is
fabricated. Captured diagnostics are checked for credential output.

The final phase stops writers, uses the shipped state:backup tool, rejects a
corrupted dump, restores into a second new database and receiver path, checks
PUBLIC auth-function execution is absent, and reapplies restricted runtime grants.
Retained sessions/roles, history, replay, receipts/audit and new identity values
must work, then a newly submitted command must compute its actual receipt.
Runtime user/audit mutation and migration-history reads remain denied after restore.
All owned processes, clusters and gate state are cleaned up; the packaged archive
remains in .artifacts. Hosted CI, TLS and real-device assistive technology require
their own execution evidence.

After restore/regrant, Chromium signs in through the shipped console and uses
[Account settings](console-account.md) to replace the password. The gate checks the
actual 204/cookie clear, sign-in notice, old-session revocation, preserved peer and
command history, new-password login and retained restart.
