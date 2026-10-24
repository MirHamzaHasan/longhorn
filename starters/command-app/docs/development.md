# Source development

After [setup](setup.md), use two separate shells:

```sh
# Runtime app configuration stays in .operator.env / .operator.env.local.
pnpm dev
# Receiver shell keeps its own RECEIVER_TOKEN and RECEIVER_DATA_PATH.
pnpm dev:receiver
```

`longhorn dev --cwd DIRECTORY` also runs the unchanged app development owner.
The app watches src/ and console/ recursively and the two private operator profile files.
Its server/browser builds settle together in memory before a usable generation
replaces the current host. The receiver watches receiver/ through a separate owner.
Its output and retained receipt storage are independent of app reloads.

Compile errors keep an already running host and its built files. Fix source to
retry. Edits during a build discard that stale generation; edits during native
shutdown wait for a later usable generation. Reload stops/drains the old native
host before writing/starting the replacement. This preserves sessions, commands
and receipts in their retained stores. Reload the browser to fetch updated assets;
this is full host replacement rather than browser state-preserving hot updates.

Private profile edits trigger app rebuild/relaunch, and the child reads/validates
the current profile. Receiver environment changes require restarting its shell
owner. Startup/config/schema/port failures and unexpected child exits stop the
watcher with a failed result; fix the cause and rerun. Build configuration or
dependency changes also require restarting the owner. This does not run migrations.

Ctrl+C stops admission to more builds, closes filesystem watches, awaits admitted
builds and drains the child. Native cleanup has ten seconds before a forced stop
is reported as failure. Shutdown logs contain role/stage counters, not credentials.
One owner per role should write its outputs: stop development owners before a
one-off pnpm build or starting another host against the same listener/data path.
The app and receiver development commands may run alongside each other.
