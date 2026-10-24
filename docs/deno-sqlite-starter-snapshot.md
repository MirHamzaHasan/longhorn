# Editable Deno task source and native test assets

Owner: [CLI snapshot builder](../cli/scripts/snapshot.mjs) and
[Deno starter assets](../starters/deno-sqlite-tasks/README.md). The existing trusted
[asset validator](application-template-assets.md) retains descriptor version 1,
fixed variant selection, UTF-8/byte/path/hash checks and atomic project publication.

The builder copies shared task app/config/repository/events/cache/test-support
source. Native host/storage come from examples/deno-sqlite; two/four checked
relative imports become project-local. One checked port default changes 3017 to
the shared 3000 default. Node/Redis host wiring is excluded, and drift in these
mapping boundaries stops the CLI build for review.

Exactly six application test files are retained. Runner imports become the shipped
tests/runner.ts adapter, Node storage/listener selections become Deno, and one
cache mock gets an explicit function type required by jest-mock. Test logic and
real store behavior stay intact. The adapter uses native node:test cases/hooks,
pinned npm expect/jest-mock and a case-table expansion into actual native tests.
It does not implement assertions or run Vitest in a separate Node host.

build-tests.mjs bundles each editable test graph with external npm/framework
packages. Deno then runs JavaScript, resolving the source's .js-to-TypeScript
imports during compilation rather than an unstable runtime resolution mode.
Typechecking includes source and the typed case adapter.

The persistence test retains the existing application's verification body, with
checked adaptations selecting the Deno provider and native Deno.Command ownership
through tests/processes.mjs. Node tooling resolves the pinned runtime; the native
parent verifies actual status/output drain and closes children before removing
temporary storage. Source/mapping corruption and required native test omissions
are tested before any destination output. See [profile](deno-sqlite-starter.md),
[permissions](deno-sqlite-starter-permissions.md) and [proof](deno-sqlite-starter-testing.md).
