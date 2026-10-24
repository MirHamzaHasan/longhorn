# Independent Bun SQLite starter verification

Owner: [verify-sqlite-project.mjs](../scripts/verify-sqlite-project.mjs), parameterized
by node/bun while retaining Node as its default. Run `pnpm test:bun-sqlite-project`,
or `node scripts/verify-sqlite-project.mjs bun` after a full build. CI's existing
source-and-runtimes job includes both variants.

The verifier first creates through the workspace binary and compares actual shared
source plus the checked Bun host/storage path adaptation. It packs both CLI
packages, installs them in an unrelated consumer, creates via the installed
creation-only binary with automatic install, and relocates the project. A CI-mode
frozen reinstall must preserve its lockfile. No source imports point back into the
checkout, and the selected framework closure excludes Node/Workers adapters.

Installed CLI typecheck/test/build commands exercise real declarations, all six
adapted application test files under Bun, and the compiled host. The shipped native
persistence test runs through the project's Bun executable, verifying actual
multi-process HTTP writes, retained CRUD/schema history and SQLite integrity.

Further installed hosts verify Bun's environment-file/process precedence from the
project cwd, explicit environment settings and project-relative data paths from a
different cwd, concurrent writers, nonreused IDs, retained completion/deletion,
request correlation, local-only activity and TTL-bounded cross-host summaries.
Development deliberately breaks syntax, verifies the old host remains available,
then fixes source and checks retained data through an owned replacement. CLI stop
must report application/development cleanup and close the listener.

Invalid configuration creates no data directory. Changed applied migration SQL
rejects readiness and stops development; restored source reopens retained tasks.
The verifier owns children and temporary files, preserving unrelated applications.
The general source suite separately verifies runtime/profile selection, public
metadata identity, package closure and corrupt native test assets before output.

The existing [Bun provider gate](bun-sqlite-testing.md), default four-runtime project
gate, [Node SQLite project](sqlite-starter-testing.md) and [D1 project](d1-starter-testing.md)
remain separate regressions. Local OS results and hosted Actions results must be
reported independently. Passing this gate does not establish cloud deployment,
production account policy or every optional database store.

## Local evidence

At the initial Bun starter milestone on macOS ARM64, frozen installation, the full build/type checks and 511 source
tests across 84 files passed. The relocated generated Bun app passed 44 native
tests across six files (187 assertions), followed by the shipped persistence gate
and installed HTTP/development/failure checks. The existing 13-test Bun provider
gate, Node SQLite/D1 packed projects and all four default runtime projects passed.
Validation checked 300 source Markdown files and 2617 local links; the original
LICENSE blob was preserved. Hosted Actions results remain separate from this
local evidence and the account's existing runner-budget restriction.

Current bounded-read, aggregate and retained-index verification is recorded in
[task read upgrades](sqlite-task-read-upgrades.md).
