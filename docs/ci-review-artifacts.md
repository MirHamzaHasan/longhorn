# Hosted application and browser review artifacts

Owner: `.github/workflows/verify.yml`. Connects [release verification](release-verification.md),
[console captures](console-testing.md) and [independent application](command-app-distribution.md).

The browser job retains its actual PNG captures and accessibility.json as
`longhorn-console-RUN_ID`. The upload runs even if the browser gate fails, preserving
captures already made; no-files is a warning so the original gate result remains
visible. Successful captures cover the existing light/dark desktop/phone and
failure-state workflow, not fabricated preview data.

The independent-distribution job uploads `longhorn-command-app-RUN_ID` only after
the relocated frozen install, app workflow and offline restore gate succeeds.
It contains the application tar archive and SHA-256 sidecar. The tar includes
editable source, license, local framework snapshots, dependency lock and setup
guides. Download the artifact from that run, unpack its outer ZIP, then verify
the sidecar and extract the tar into a new directory. Follow its README's frozen
installation and deployment steps. A failed gate does not publish an application
artifact as verified.

Both artifacts are retained for 14 days in the private repository's Actions run.
Use the run URL and source commit when reviewing results; retained artifacts are
review outputs, not registry publication or a tagged release. The upload action
is pinned to the commit for v7.0.2. Hidden-path inclusion is enabled for the exact
listed .artifacts paths only. Database/receiver state, environment profiles,
node_modules and the complete workspace are never upload paths.

The [official upload action](https://github.com/actions/upload-artifact/tree/v7.0.2)
documents named artifacts, retention and hidden-file handling. Actual hosted
artifact IDs/download availability must be verified after the workflow runs;
a configured upload step alone does not prove an artifact was produced.
