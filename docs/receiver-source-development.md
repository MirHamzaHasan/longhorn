# Retained receipt receiver source development

Owner: command-app dev.mjs --receiver, shared build.config.mjs and the existing
scripts/serve-receiver.mjs resource owner. Connects [app development](command-source-development.md),
[receiver transport](operator-receipt-transport.md), [durable effects](receipt-deduplication-conflicts.md)
and [verification](command-development-testing.md).

Use the separately configured receiver shell from the generated setup guide:

```sh
pnpm dev:receiver
```

Its existing RECEIVER_TOKEN, RECEIVER_DATA_PATH, HOST and PORT select the protected
local workerd receiver. This command watches receiver/ recursively, builds only
dist/receiver in memory and owns a Node receiver host. A valid source generation
closes the old Miniflare/workerd host before writing and starting the next one.
The retained receipt directory stays in place. App/browser output and the database
host have their own development owner and are not restarted by receiver edits.

Compile failures retain the running receiver and its output. Fixing source starts
a fresh host against the same persisted Object SQLite receipts. Native proof reads
an actual preexisting computation after reload, rather than reconstructing or
seeding it. Existing bearer verification, envelope validation and effect identity
remain unchanged; editing source does not install a new business contract version.

Receiver shell environment changes require restarting this owner. Its source does
not read the app's private profile or gain deployment credentials. Config/startup
failure and unsuccessful cleanup stop development with failure. Production hosting,
simultaneous receiver owners against one data path and managed cloud failover are
separate concerns. Use one owner and the existing backup/restore maintenance policy.
