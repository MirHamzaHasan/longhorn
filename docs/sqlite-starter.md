# Standalone Node SQLite task starter

Owner: cli/src/sqlite-template.ts and the existing basic task application.
Connects [project generation](project-generation.md), [asset distribution](application-template-assets.md),
[native lifetime](sqlite-starter-lifecycle.md) and [installed proof](sqlite-starter-testing.md).

```sh
pnpm create:app ../local-tasks --runtime node --template sqlite-tasks
cd ../local-tasks
pnpm install
pnpm dev
```

This variant selects Node explicitly; the [Bun variant](bun-sqlite-starter.md) uses
the same public SQLite template with --runtime bun. api remains the default four-runtime starter;
d1-tasks remains the separate Workers profile. Both creation binaries and
createProject accept sqlite-tasks. Incompatible runtime/profile combinations fail
before output. Generated metadata reports the selected template and retains the
existing CLI build/dev/start/test/typecheck delegation contract.

The installed project contains actual editable examples/basic source, application
tests, Node build configuration, environment example and feature guides. The separate
Redis host/config files are excluded; this executable selects file SQLite, typed
process-local observations and a derived memory summary cache. It opens no Redis
or PostgreSQL service. Framework packages retain their own explicit optional exports.

Tasks live in project data/longhorn.sqlite by default. Source and compiled entrypoints
resolve the same data/env location even from another cwd. .env/.env.local supply
settings with process values winning; :memory: is explicit. Schema history is
checked/applied before listening and native shutdown drains resources.

This is the existing Node task API: public CRUD, decimal IDs, complete task lists,
process-local /activity and derived /summary. Activity/cache do not persist or
automatically observe other hosts. It has no account isolation, revision conflicts
or request-key replay. D1's separate protocol is documented in [its profile](d1-starter.md).
See [task integration](tasks-example.md), [events](task-events.md) and [cache](task-cache.md).

Generated sources remain editable, and .longhorn/ plus relative file overrides
keep the project independent of the checkout. First installation creates its own
lockfile; frozen reinstall preserves that graph. No publication, production
deployment or automatic framework/schema upgrade occurs.
