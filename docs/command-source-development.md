# Source-aware command application development

Owner: generated command-app dev.mjs, dev-host.mjs and build.config.mjs.
Connects [CLI profile](command-project.md), [paired builds](command-development-builds.md),
[native lifetime](command-development-lifecycle.md), [receiver development](receiver-source-development.md)
and [verification](command-development-testing.md).

After the generated docs/setup.md has configured PostgreSQL and the protected
receiver, run the app watcher from its runtime shell:

```sh
pnpm dev
# Or use the installed generator CLI:
longhorn dev --cwd /path/to/my-console
```

The Node owner recursively watches src/ and console/. It also notices replacement,
creation and removal of .operator.env and .operator.env.local. Changed code builds
the server and browser together in memory. A usable current generation drains the
old native process, writes its outputs and starts one replacement. Source errors
keep an already running generation; an initial failure waits for a fix without
launching older dist files. Rapid changes discard superseded build results.

The child retains the existing host's config validation, role checks, HTTP/resource
drain, outbox and optional request cleanup. It reopens the same database instead of
recreating state. Sessions, request replay, commands and saved views survive reload.
The browser fetches new immutable assets after manual reload; browser state is not
hot-swapped. No development endpoint, websocket or relaxed account policy is added.

Receiver source has its [own development command](receiver-source-development.md)
and separate credential/storage ownership. App edits do not rewrite receiver
output. Each role has one development owner; stop owners before one-off build or
another host using the same output/listener. Database deployment remains explicit.

Config files are reread by each child. Invalid startup config/schema/grants/ports
or unexpected child exit stops the owner with failure; fix the cause and restart.
Changes to dependency installation, build.config.mjs or launcher code require
restarting the watcher. Native filesystem behavior is verified on the recorded
Node/macOS profile; other platforms require their own execution evidence.
