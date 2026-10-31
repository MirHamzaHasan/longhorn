# Tasks

How several agents work here without overwriting each other. Each task file holds
the context for one piece of work, so an agent reads that file instead of the whole
repository.

## The flow

```sh
pnpm task list                                   # see the board
pnpm task new fix-cursor --title "Fix cursor" --paths packages/queue/ --shared docs/features.md
pnpm task claim task012 --agent codex            # creates the branch and worktree
cd ../LongHorn-worktrees/fix-cursor
pnpm install --frozen-lockfile
# ...work...
pnpm task check                                  # before every commit
pnpm task release task012 --status review
```

## What keeps agents apart

| Risk | What prevents it |
| --- | --- |
| Two agents edit the same files | `paths:` are exclusive. `claim` refuses an overlap with an active claim |
| One agent drifts into another's area | `check` lists every changed file outside your claim and exits 1 |
| `dist/` or `.artifacts/` overwritten during a gate | Each task has its own worktree, so each has its own |
| A shared board causes merge conflicts | There is no board file. `list` builds it from task files and claims |
| Claims conflict in git | Claims live in `.git/longhorn-claims/`, seen by every worktree and never committed |
| Agents read everything | Each task's `Read first` names only what that task needs |
| Ports clash | Set `PORT` for dev hosts. Run fixed-port gates one at a time on a machine |

Claims are local to one machine. An agent in the cloud cannot see them, so before
starting remote work, push a branch and mention the task in its PR.

## Paths and shared files

- `paths:` is what you own exclusively. Use `dir/` for a folder or an exact file. Keep
  it as narrow as the task allows; claiming `packages/` blocks everybody.
- `shared:` is what you may edit alongside others, using append-only edits:

| Shared file | How to edit it |
| --- | --- |
| `package.json` | Add one script line |
| `docs/features.md`, `docs/roadmap.md`, `docs/architecture.md`, `docs/supported-runtimes.md` | Add your row or section. Leave the rest alone |
| `vitest.config.ts` | Add your alias lines |
| `.github/workflows/verify.yml` | Add your step |
| `pnpm-lock.yaml` | Never hand-merge. Take the base version and rerun `pnpm install` |

Make shared edits last, after rebasing. If you need a large rewrite of a shared file,
make it its own task and own that file in `paths:`.

## Task files

One file per task: `tasks/taskNNN-short-name.md`, created by `pnpm task new` from
[TEMPLATE.md](TEMPLATE.md). Keep it short, and link to docs instead of copying them.

| Status | Means |
| --- | --- |
| `backlog` | Not started. Free to claim |
| `active` | Shown while a claim exists. You never write this yourself |
| `blocked` | Cannot proceed. The file says on what |
| `review` | Finished by the agent and waiting for the owner |
| `done` | Merged, or accepted by the owner |

## Finishing

A task reaches `review` only when its acceptance checks have been run and the
Evidence section says what ran and what happened, including anything skipped or
failed. Evidence may point to `.artifacts/`, but that folder is not committed, so
state the result in the file too.

Then `pnpm task release <id> --status review`. Leave the worktree for the owner to
inspect. Remove it after merge with `git worktree remove <path>`.

## Recovering

- Stale claim from a dead session: check that nothing is running in the worktree,
  then `pnpm task release <id> --status backlog`. Its branch and worktree remain.
- Real overlap: narrow your `paths:`, split the task, or wait. `--force` exists for
  the owner's decision, not for hurrying past another agent.
