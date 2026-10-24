# Independent SQLite starter verification

Owner: scripts/verify-sqlite-project.mjs and the generated tests/persistence.mjs.
Connects [selection](sqlite-starter.md), [assets](application-template-assets.md)
and [resource lifetime](sqlite-starter-lifecycle.md).

```sh
pnpm test:sqlite-project
```

The gate creates through the workspace CLI, packs/installs both creation tools
into a separate consumer, then uses the installed create-longhorn binary with
automatic installation. The generated app moves to a path containing spaces
before frozen reinstall. Its lock bytes remain unchanged. Installed CLI commands
run TypeScript, copied application tests and the Node build; selected production
files match the original example bytes and contain no source-checkout link.

The shipped persistence gate runs actual separate Node processes against temporary
SQLite. It proves concurrent writers, update/delete retention, nonreused IDs,
schema history, native file header and PRAGMA integrity_check. It never touches
the project's normal database.

Actual installed HTTP hosts verify .env/.env.local/process precedence, project-relative
paths from a different cwd, two-process writes, request-correlated activity, uncached
authoritative reads and TTL-bounded summary recovery after an external write.
Restart retains tasks and resets process-local activity. Native source watching
preserves data and closes its listener; invalid configuration creates no directory.
Changed applied migration text rejects readiness, and restoring source reopens
the retained state.

The existing installed D1 starter gate is rerun after the shared reader refactor,
including browser build, private schema, request replay, failed-compile retention,
reload/restart and shutdown. Unit tests reject incompatible SQLite runtimes and
missing assets while retaining existing corruption/path/metadata checks. Local
evidence is macOS ARM64 / Node 20.19.4. CI adds the SQLite project gate to the
existing source/runtime job; runner availability/current-head hosted results remain
separate. No Windows/native network-filesystem durability or production deployment
is inferred from these checks.

The complete source suite passes 509 tests in 84 files. Frozen workspace install,
build/types, all four default starter gates and the installed D1 regression pass.

[Draft PR #8](https://github.com/MirHamzaHasan/longhorn/pull/8) records review.
Its [first hosted run](https://github.com/MirHamzaHasan/longhorn/actions/runs/40049074639)
failed all seven jobs with zero steps and no runner allocation. The source/runtime
annotation identifies the Actions budget restriction, independently of local success.
