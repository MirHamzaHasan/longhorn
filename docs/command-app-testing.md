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

The restored app also opens a source created before the checkpoint, follows
[Run again](command-rerun.md), reloads the review link and creates a distinct
command/delivery with a real computed receipt. The original receipt remains, and
ordinary current-browser history includes the new row before scoped sign-out.

Before scoped sign-out, that same restored browser selects Delivered and sees
all four actual commands, selects Failed and sees an empty result, then uses Show
all to restore the complete list. This exercises the shipped [filter assets](console-history-filters.md),
query/cursor schema and appended indexes after restore/regrant/restart.

The shipped detail also [follows a failed command](command-follow-testing.md) while
an actual operator recovery delivers its receipt. Chromium receives that computed
result without Refresh status before both processes restart. The later restored
rerun must likewise show its actual receipt in the current detail before leaving.

The restored shipped console also downloads [history NDJSON](history-export.md).
Its header/summary and four command IDs must match the retained/new rows exactly;
no numbers, outgoing payload or lease tokens may appear in the actual file.

The restored shipped browser also preserves its Delivered view in the actual
fragment across reload and Back/Forward before exporting those four commands.
[Saved-view proof](history-view-link-testing.md) separately exercises cold/expired
sign-in, other accounts, operator denial and invalid route claims.

After restore, the shipped browser searches a retained Delivered UUID, verifies
its canonical query across reload and exports exactly that command as [v2 NDJSON](history-search-export.md).
Clearing only search returns to all four delivered commands before existing
account/session regressions continue. Native [search proof](history-search-testing.md)
separately covers migration interruption, index plans and combined cursor context.

The restored/restarted shipped console also exports [recovery audit NDJSON](recovery-audit-export.md)
through its retained operator cookie in a separate browser context. The actual file
matches the restored record's actor, reason, request and outcome exactly and excludes
payload/credentials. Member command-export selection and v1/v2 files are still checked.

The restored console also [exports computed receipts](receipt-export-testing.md)
for all four retained/new member commands, then re-reads/exports one command detail.
Actual receipt message IDs/results match the protected receiver state. The packed
artifact must include receipt helpers, tests, shared metadata and its own feature guide.

The archive also checkpoints a real [named history view](saved-view-testing.md),
restores its exact owner/selection/revision, then reopens and updates it through
a fresh password-authenticated browser. The shared pure values, schema, repository,
router and starter guide must be present in the shipped source.
