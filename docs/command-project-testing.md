# Packed command project verification

Owner: scripts/verify-command-project.mjs, generator/command source tests and the
shared scripts/verify-command-app.mjs native workflow. Connects
[profile](command-project.md), [snapshot](command-project-snapshot.md),
[lifecycle](command-project-lifecycle.md) and [archive proof](command-app-testing.md).

```sh
pnpm test
pnpm test:command-project
pnpm test:command-app
```

The native workflow needs Chromium and the existing PostgreSQL 18 client preparer,
as described in the archive proof guide. All processes, test databases, installed
consumers and temporary source directories are owned by these gates.

Source cases verify the complete profile's Node/receiver dependency selection,
names, script/metadata preservation, missing deployment/backup/receipt/setup assets,
damaged receiver hashes and incompatible runtimes. Existing shared reader and
generator cases retain path/UTF-8/hash/bound checks, protected destinations and
failed-copy staging cleanup. CLI argument cases reject incompatible selections.

The installed gate packs both real CLI packages and installs them in a separate
consumer, then relocates that consumer. It runs both actual entrypoints. Creation
without installation has no lock/modules output and contains exact editable source
and guides, the chosen name, intended framework packages and no workspace paths.
Actual unsupported runtimes, an occupied target, corrupted receiver and missing
setup descriptor entry fail without publishing a destination. A deliberately
failed pnpm installer retains a complete app and returns its original exit code.

The second app is created with --install in CI mode, relocated, frozen-installed
without changing its lock and packaged with a matching lock hash/checksum. The
installed CLI must preserve custom pnpm start scripts and hook cases, including
their lifecycle environment and nonzero exit codes.

That CLI-created artifact enters the same complete archive workflow, through
internal --archive/--cli QA inputs. Its installed CLI runs typecheck/test/build and
owns each real host startup/restart. Actual restricted PostgreSQL, native accounts,
workerd receiver, Chromium command/receipt/recovery, offline backup/restore,
password/session controls, named views, search, exports and opt-in cleanup all run.
POSIX terminal-group SIGINT and ordinary owner SIGTERM must return cleanly and
release the listener for restart. No successful business response is fabricated.

Ignored .artifacts/longhorn-command-project.tgz and its checksum retain the actual
CLI-created project; command-project-proof.json records source/behavior outcomes.
The independent-distribution CI job runs both archive and packed-project gates
before attempting to upload their source artifacts. Hosted execution and upload
availability remain separate evidence from local results. No new browser screen,
tagged release, registry publication or deployed infrastructure is claimed.
