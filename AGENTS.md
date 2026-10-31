# LongHorn agent guide

Read this file, then your task file, then the `AGENTS.md` of the area you are
changing. Stop there until the work needs more. There are 387 docs; nobody needs
all of them.

LongHorn is a modular TypeScript backend framework on Hono and Web Standards, with
native hosts for Node, Bun, Deno and Cloudflare Workers. A complete Node/PostgreSQL
command application exercises the modules together. It is unpublished.

## Owner directions

Newest first. Say what a new direction supersedes.

### Open source · owner direction, 31 October 2026

"Push it to main, set all GitHub rules as this is going to be opensource project."
The work is on `main`. Repository rules are in `docs/repository-settings.md`. This
supersedes the stacked draft PR workflow.

### Agent workflow · owner direction, 31 October 2026

"Make this repo ready for agentic coding ... proper task wise nice context
distribution so we dont mess with each other thing." Work runs through `tasks/`,
one claimed task per agent, as described below.

### Development pause · owner direction, 24 October 2026

Feature development paused; see `docs/development-handoff.md`. Still in force for
new framework features: start one only when the owner asks. Agent tooling, the
website and the README were requested on 31 October 2026 and are not covered by it.

## Before you change anything

```sh
pnpm task list                                # board, claims, who owns what
pnpm task claim task007 --agent claude        # own a task in its own worktree
```

- One agent, one task, one worktree. If no task fits, create one with `pnpm task new`.
- Never edit a path another active task owns. Claiming refuses overlaps; if you
  need that path, split the work or wait. Do not use `--force` to get past a person.
- Run `pnpm task check` before committing. It lists files outside your claim.
- Unrelated uncommitted work may exist. Never stash, reset, clean or overwrite it.

The full protocol is in [tasks/README.md](tasks/README.md).

## Where to read next

| Changing | Read |
| --- | --- |
| `packages/` | [packages/AGENTS.md](packages/AGENTS.md) |
| `runtimes/` | [runtimes/AGENTS.md](runtimes/AGENTS.md) |
| `examples/`, including the console | [examples/AGENTS.md](examples/AGENTS.md) |
| `cli/`, `create-longhorn/` | [cli/AGENTS.md](cli/AGENTS.md) |
| `starters/` | [starters/AGENTS.md](starters/AGENTS.md) |
| `scripts/`, `.github/workflows/` | [scripts/AGENTS.md](scripts/AGENTS.md) |
| `native/` | [native/AGENTS.md](native/AGENTS.md) |
| `docs/` | [docs/AGENTS.md](docs/AGENTS.md) |
| `site/` | [site/AGENTS.md](site/AGENTS.md) |

For the whole system: [docs/project-guide.md](docs/project-guide.md). To find one
feature's guide, search [docs/features.md](docs/features.md) instead of reading it.
Avoid reading `docs/roadmap.md` and `docs/v0.1-plan.md` end to end; they are long
histories. [docs/development-handoff.md](docs/development-handoff.md) has the state.

## Commands

Node 20.19+ and pnpm 12.6.0.

```sh
pnpm install --frozen-lockfile
pnpm build            # required before typecheck and before any scripts/verify-* gate
pnpm typecheck        # uses built declarations, so never run it at the same time as build
pnpm test             # source tests; resolves workspace source, needs no build
pnpm test:tasks       # the task tool's own tests
```

Pick the narrowest gate that exercises your change:

| Change touches | Run |
| --- | --- |
| One package, no native behaviour | `pnpm vitest run packages/<name>` |
| SQL provider | The provider's gate, such as `pnpm test:postgres` or `pnpm test:persistence` |
| A runtime adapter | `pnpm test:runtimes` |
| Console | `pnpm test:console`, or its narrower `test:history-*` script |
| Command app distribution | `pnpm test:command-app`, `pnpm test:command-project` |
| CLI or a starter | `pnpm test:projects`, plus that starter's `test:*-project` |
| Outbox and delivery | `pnpm test:outbox`, `pnpm test:outbox-recovery` |

CI's job list is in `.github/workflows/verify.yml`.

## Rules the code depends on

- Portable packages stay free of Node APIs. Native I/O belongs in `runtimes/` or an
  explicit provider subpath.
- Core installs nothing implicitly. Applications import and wire optional modules.
- Hono policy stays at the application boundary.
- Accepted work drains before the resources it borrowed are released.
- Migrations are forward-only and checksummed. Append after the complete profile.
  Never edit a deployed statement or insert before later migrations.
- HTTP runtime database roles get no schema ownership.
- Never clean `dist/` while a gate that imports it is running.
- There is no linter or formatter. Match the file you are in, including its density.

## Claims must be true

Tests here run real engines, processes and browsers, and the docs keep that
distinction. Keep it too.

- Say exactly what ran. "Built" is not "tested", and local is not hosted CI.
- Do not write exactly-once, production-ready or published unless it became true.
- A feature is not finished without its own guide and a row in `docs/features.md`.
- Never put secrets, tokens, or real private data in code, docs, tasks or artifacts.

## Git

- Commit or push only when the owner asks. Changes reach `main` through a pull request.
- Branch as `<agent>/<slug>`; `pnpm task claim` does this.
- Use the existing style: `feat(scope): ...`, `fix: ...`, `test(scope): ...`.
- Everything public is permanent. Check for secrets before you push.
