# Complete command applications through the CLI

Owner: command-app profile in `@longhorn/cli`, shared with
[the independent archive](command-app-distribution.md). Connects
[project generation](project-generation.md), [complete workflow](command-application.md),
[checked source](command-project-snapshot.md), [script ownership](command-project-lifecycle.md)
and [native proof](command-project-testing.md).

```sh
pnpm create:app ../my-console --runtime node --template command-app --install
cd ../my-console
pnpm typecheck
pnpm test
pnpm build
```

Both longhorn create and create-longhorn accept this selection. --name overrides
the inferred package name. Without --install, generation performs local filesystem
work only; it starts no host, installs no dependency and provisions no database.
--install runs pnpm after complete publication; a failed installation retains the
whole project and returns the install exit code for an explicit retry.

The project includes the actual editable PostgreSQL app, console, protected receipt
receiver, source tests, complete migrations, role tools, backup/restore tools,
runtime example and per-feature guides. It uses the existing Hono, DI, SQL,
idempotency, outbox, authentication and resource-lifetime contracts. There is no
second implementation of the command workflow.

Node is required for this application's PostgreSQL/native-password host. The
Workers package is selected for its separate local receipt receiver; it does not
make Workers an app runtime choice. Bun/Deno/Workers app selections fail before
filesystem output. Their existing api/task/auth profiles remain available.

Follow the generated docs/setup.md after building: supply separate owner/runtime
database roles, deploy schema/grants, configure retained receiver storage and the
private runtime profile, then start both hosts. The CLI's next-step message points
there because a newly created project has no database credentials or accounts.
Generation does not imply PostgreSQL installation, account seeding or deployment.

CLI first installation resolves external dependencies and creates pnpm-lock.yaml.
Retain/review it, then use frozen installs for deployment. The prebuilt archive
already carries a lock and its origin hash. Both forms have the same checked
application template and selected local framework closure; neither needs this
checkout after creation. See [dependency policy](command-app-dependencies.md)
and [deployment](command-app-deployment.md).

Generated apps now include [source development](command-source-development.md):
paired app/console rebuilds, private profile reload and a separate retained receiver
watch command. Existing setup, account policy and deployment ownership are retained.

The generated [preflight command](operator-preflight.md) now inspects the configured
runtime before serving. It shares native config/schema/role/transport checks,
emits fixed private-safe observations and closes its independent pool.
