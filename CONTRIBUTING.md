# Contributing to LongHorn

Thanks for helping. LongHorn is pre-release, so APIs can still change.

## Before you start

- Bugs and small fixes: open a pull request directly, or an issue if you are unsure.
- New features or large changes: open an issue first, so nobody spends time on
  something that doesn't fit.
- Security problems: do not open an issue. Follow [SECURITY.md](SECURITY.md).

## Set up

You need Node 20.19 or newer and pnpm 12.6.

```sh
git clone https://github.com/MirHamzaHasan/longhorn.git
cd longhorn
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
```

Run `pnpm build` before `pnpm typecheck` and before any `scripts/verify-*` gate. Don't
run them at the same time, because a build replaces the output they read.

## Find your way around

- [Architecture guide](docs/project-guide.md): how the whole system fits together.
- [Feature index](docs/features.md): the guide for each feature.
- [AGENTS.md](AGENTS.md): the code rules and the test to run for each kind of change.
  It is written for coding agents, and it is just as useful for people.

## Make a change

1. Branch from `main`.
2. Match the file you are in. There is no linter or formatter.
3. Add or update tests.
4. Run the narrowest gate that exercises your change. `AGENTS.md` lists them.
5. Update the feature's guide, and `docs/features.md` if you added a feature.
6. Open a pull request and fill in the template.

Commit messages follow `feat(scope): ...`, `fix: ...` or `test(scope): ...`.

## Rules the code depends on

- Portable packages stay free of Node APIs. Native I/O belongs in `runtimes/` or an
  explicit provider subpath.
- Migrations are forward-only. Append new ones, and never edit one that has shipped.
- Accepted work finishes before the resources it borrowed are released.
- Generated projects must work outside this repository.

## Claims must be true

The docs separate what was really run from what wasn't. Keep that distinction. Say which
checks you ran and on which platform. Don't write exactly-once, production-ready or
"works on X" unless it was tested. It's fine to say you couldn't run a gate.

## Using coding agents

You're welcome to. You remain responsible for what you submit, so check that it works.
Agents working in parallel should use the [task protocol](tasks/README.md).

## Licence

By contributing, you agree that your contribution is licensed under the
[MIT License](LICENSE).
