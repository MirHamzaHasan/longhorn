---
id: task001
title: Make the repository ready for agentic coding
status: done
paths:
  - AGENTS.md
  - CLAUDE.md
  - tasks/
  - scripts/task.mjs
  - scripts/task.test.mjs
  - .gitignore
  - .node-version
shared:
  - package.json
---

## Goal

Several agents can work at once without overwriting each other, and each loads only
the context its task needs.

## Owner direction

31 October 2026: "make this repo ready for agentic coding and make sure you add
proper gitingnore as well proper task wise nice context distrubution so we dont mess
wiht each other thing".

## Evidence

31 October 2026, on macOS ARM64, Node 20.19.4:

- `pnpm test:tasks`: 8 of 8 passed, using real temporary repositories and worktrees.
- `git ls-files -ci --exclude-standard`: empty, so the new `.gitignore` hides no
  tracked file.
- Found and fixed a flaky test, `runtimes/node/src/process.test.ts`. It treated an
  empty PID file as a PID. Before: failed 3 of 7 runs. After: 0 failures in 20 runs of
  the file, and 749 of 749 on 3 full `pnpm test` runs.
- Not applied: `.claude/settings.json`. The permission system blocks an agent from
  writing it, so the owner applies it by hand.
