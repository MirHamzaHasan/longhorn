# Native command development proof

Owner: scripts/verify-command-development.mjs, called by the existing packed
[command-project gate](command-project-testing.md) after its complete restore flow.
Connects [builds](command-development-builds.md), [process ownership](command-development-lifecycle.md)
and [receiver source](receiver-source-development.md).

```sh
pnpm test
pnpm test:command-project
pnpm test:command-app
```

Generator cases require the new tools and development guide before staging. Native
custom dev/start and pre/post-hook cases retain pnpm environment/exit semantics.
The packed installed CLI creates, relocates, installs and builds the actual source
artifact; its existing SQL/browser/receiver/backup/restore flow runs first.

Only then does the development helper edit the gate's extracted source and launch
the installed CLI's dev owner plus an explicit receiver watcher. Initial invalid
source must launch no old dist host. A later server compile failure paired with a
valid CSS edit must retain both the old HTTP response and asset/compiled bytes.
Fixing source updates actual HTTP/CSS. New nested modules and edits verify recursive
watch behavior rather than just writes to an existing entrypoint.

A real owner transaction holds the commands table while an authenticated command
HTTP write waits. Source reload asks the old child to drain; no replacement may
start while that request is blocked. Several new source generations arrive during
the wait. Releasing SQL commits one command, a later host serves the latest source,
same-key replay returns its committed reply and the receiver computes sum 42.
The original session and business count are preserved.

Actual receiver parse failure retains its host, while a fixed source edit restarts
it without reloading the app. A protected old computed receipt survives. Creating/
editing the private profile reloads the app; invalid config stops it with failure,
and a corrected restart preserves the session. POSIX terminal-group interrupts
stop both development roles and release listeners. A deliberately noncooperative
native child is forcibly stopped and must reject clean-close verification.

Owned processes, locks, pending requests and temporary source edits are released
even on failure. No credentials may appear in captured owner output. Ignored
.artifacts/command-development-proof.json records the observed outcomes, and the
independent-distribution CI job retains it only after successful packed/native proof.
Hosted execution, other OS filesystem behavior and production supervision require
their own evidence. This adds no new browser screen or cloud deployment claim.
