---
id: task014
title: Stop a clean Deno shutdown reporting a failed cleanup
status: done
paths:
  - starters/deno-sqlite-tasks/host.mjs
shared:
depends:
---

## Goal

A Deno host ended by the SIGTERM its launcher asked for counts as stopped. Forced kills, non-zero exits and other signals still count as failures.

## Owner direction

31 October 2026: "ok lets check and finalize that thing for me". Found while confirming CI for the required checks.

## Read first

- [starters guide](../starters/AGENTS.md)

## Scope

`stopHost` treated any signal exit as a failure. On hosted Ubuntu the host sometimes logged `Application stopped` and then ended with `signal: SIGTERM`, so `dev.mjs` reported `Development cleanup failed` and `verify-sqlite-project deno` failed. `start.mjs` shares this function.

## Out of scope

`starters/sqlite-auth/host.mjs` and `starters/command-app/dev-host.mjs` have a similar check. They weren't seen failing and weren't changed.

## Acceptance checks

- `node scripts/verify-sqlite-project.mjs deno` exits 0.
- The old and new `stopHost` are compared on each exit shape, and only the SIGTERM exit changes.
- The `source-and-runtimes` job passes repeatedly on hosted Ubuntu.

## Evidence

31 October 2026.

- Hosted, with temporary logging on `493af3c`, run 41219532553: attempts 1 to 4 passed. Attempt 5 logged `Application stopped`, then `{"forced":false,"code":null,"signal":"SIGTERM"}`, then `Development cleanup failed`, at the same gate line as the earlier failures.
- macOS ARM64, Node 20.19.4, `stopHost` from the old and new files against real child processes and recorded outcomes. Only the SIGTERM exit changed, from failed to stopped. Non-zero exit, SIGKILL after the 10 s limit, SIGTERM with a failed permission file cleanup, and another signal all still fail.
- macOS ARM64, real gate with this change, three runs: exit 0 each time. The failure never appeared in eight runs on macOS without the change, so these runs don't show the fix working.

What sent the second signal wasn't observed. A signal to the process group plus the launcher's own SIGTERM would explain it. A host killed by SIGTERM part way through closing would also now count as stopped; the gate separately requires `Application stopped`.

Hosted run 41222595193 on `c10abe7`, with this fix: `source-and-runtimes` passed 6 of 6 attempts. The job failed in 3 of 7 runs that reached this step before, and on attempt 5 of 5 with logging, so this makes the fix likely but does not prove it.
