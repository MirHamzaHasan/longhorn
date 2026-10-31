# LongHorn development handoff

Updated 31 October 2026. Feature development remains paused at the owner's request. The
framework is on `main` and the repository is public. Start with the
[architecture guide](project-guide.md), then use the [feature index](features.md) and
[detailed architecture](architecture.md) for individual connections.

## Current state

| Item | State |
| --- | --- |
| Code | On `main`, including live command history, the agent workflow and the website |
| Repository visibility | Public |
| Branch protection | Active on `main`, without required checks yet. See [repository settings](repository-settings.md) |
| Website | Live at https://mirhamzahasan.github.io/longhorn/. See [website](website.md) |
| Hosted CI | All 8 jobs passed on the fix in PR #56. See below |
| Packages | Not published |
| Cloud deployment | None performed |

The [task board](../tasks/README.md) lists what comes next. Run `pnpm task list`.

## What is already working

The framework's HTTP/DI/config/lifecycle foundations, Node/Bun/Deno/Workers adapters,
native SQL/auth, queues/schedules/events/cache, request replay/budgets,
observability/export, native report integration and CLI snapshots/starters. The complete
Node/PostgreSQL command application has protected accounts/history/receipts, operator
recovery/audit, filters/search/named views, exports, account controls, persistent
hosting and offline restore. The persistent host enables
[session inventory](session-inventory.md); the temporary demo opts into password and
scoped sign-out controls without it.

The [feature index](features.md) is the full catalogue. An implemented module or local
test result is not a claim of publication, cloud deployment or a hosted pass.

## Live command history

[Feature](command-history-updates.md), [lifecycle](history-update-lifecycle.md),
[controls](console-history-updates.md) and [verification](history-update-testing.md)
record its behaviour. It reuses the protected history API, with no new endpoint, schema
or grant.

## Last verification

31 October 2026, macOS ARM64, Node 20.19.4, on the code that went to `main`:

| Check | Result |
| --- | --- |
| `pnpm build`, `pnpm typecheck` | Clean |
| `pnpm test` | 749 of 749 tests in 119 files |
| `pnpm test:tasks` | 8 of 8 |
| `pnpm test:history-live` | Passed: real PostgreSQL, HTTP, broker and browser captures |
| `pnpm test:command-app` | Passed: relocated archive, frozen install, browser flow, outage and retry, backup and restore |

Not rerun on this code: the other native gates, including `pnpm test:command-project`.
The packed CLI distribution last passed on 24 October, before the final copy change.
Physical VoiceOver/TalkBack and other browser engines remain manual checks. The
[support matrix](supported-runtimes.md) gives the verified scope.

`pnpm test:command-app` needs PostgreSQL 18 client tools. They are built into a temporary
folder, which the OS may clear. If the backup step fails with "PostgreSQL 18 tools", run
`node scripts/prepare-postgres-clients.mjs` and try again.

Proofs and captures under `.artifacts/` are ignored and exist only on the machine that
ran them.

## Hosted review status

The first full run on `main`, on commit `55a85bb`, passed seven jobs on Ubuntu 24.04.
`source-and-runtimes` stopped at `verify-prune-packages`, whose first install could not start
from an empty pnpm cache. With that fixed, all eight jobs passed on `d4c5657`, the head of PR
#56. CI reaches about 50 of the 66 gates. The rest, including the outbox and
PostgreSQL gates, have only run on macOS. See
`tasks/task004-hosted-ci.md`.

## Continuing

1. Read [AGENTS.md](../AGENTS.md) and run `pnpm task list`.
2. Keep a build separate from compiled native/browser/distribution gates. Cleaning `dist`
   while a gate imports it invalidates the result.
3. Check exact-commit hosted status rather than assuming a local pass ran on Ubuntu.
4. Update this handoff when the state changes. Keep each feature's guide current.

Persistent application configuration, schema owners, runtime credentials and service
tokens remain the operator's private setup and are not embedded in these docs.
