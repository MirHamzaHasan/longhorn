# Hosted application and browser review artifacts

Owner: `.github/workflows/verify.yml`. Connects [release verification](release-verification.md),
[console captures](console-testing.md) and [independent application](command-app-distribution.md).

The browser job attempts to retain its actual PNG captures and accessibility.json as
`longhorn-console-RUN_ID`. The upload runs even if the browser gate fails, preserving
captures already made; no-files is a warning so the original gate result remains
visible. Successful captures cover the existing light/dark desktop/phone and
failure-state workflow using real application data. Nested
[account captures](console-account-testing.md) and their accessibility report are
also included under the same artifact; paths do not broaden to database state.
The nested [command-follow captures](command-follow-testing.md) and their report
are included by the same exact console paths.

The independent-distribution job attempts `longhorn-command-app-RUN_ID` only after
the relocated frozen install, app workflow and offline restore gate succeeds.
It contains the application tar archive and SHA-256 sidecar. The tar includes
editable source, license, local framework snapshots, dependency lock and setup
guides. Download the artifact from that run, unpack its outer ZIP, then verify
the sidecar and extract the tar into a new directory. Follow its README's frozen
installation and deployment steps. A failed gate does not publish an application
artifact as verified.

When uploaded, both artifacts are retained for 14 days in the private repository's Actions run.
Use the run URL and source commit when reviewing results; retained artifacts are
review outputs, not registry publication or a tagged release. The upload action
is pinned to the commit for v7.0.2. Hidden-path inclusion is enabled for the exact
listed .artifacts paths only. Database/receiver state, environment profiles,
node_modules and the complete workspace are never upload paths.

The [official upload action](https://github.com/actions/upload-artifact/tree/v7.0.2)
documents named artifacts, retention and hidden-file handling. Actual hosted
artifact IDs/download availability must be verified after the workflow runs;
a configured upload step alone does not prove an artifact was produced.

## Verification and storage availability

Uploads are optional review outputs. Each has continue-on-error scoped only to
its upload action. The actual source/native/browser/restore commands remain
blocking. A final step writes verification and upload outcomes separately to the
job summary and emits a warning when upload fails. Availability requires a successful
upload and a nonempty action artifact ID; success with no matching files never
claims a download exists. A green verification job is
not a claim that artifact storage or download succeeded.

The first hosted upload attempt in
[run 40037309223](https://github.com/MirHamzaHasan/longhorn/actions/runs/40037309223)
passed the independent app and restore gate, then GitHub rejected artifact creation
because the account storage quota was full. No artifact was produced. Storage
availability requires an account-level change; the workflow does not delete other
repositories' artifacts or change billing. Until storage is available, use
`pnpm package:command-app` for the local archive/checksum and `pnpm test:console`
for local captures. The upload action's original error remains visible in logs.

The nested [export captures](history-export-testing.md) and accessibility report
use those same console PNG/report paths. Downloaded NDJSON and the private native
fixture are not included by the hosted capture globs.
