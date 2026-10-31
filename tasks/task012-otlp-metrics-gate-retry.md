---
id: task012
title: Stop one slow export from wedging the metric gate
status: backlog
paths:
  - scripts/verify-otlp-metrics.mjs
shared:
depends:
---

## Goal

One export that overruns its deadline no longer fails `verify-otlp-metrics`, and an exporter that changes its bytes on retry still does.

## Owner direction

31 October 2026: "ok than fix it if there is anythign elft". Found while getting the README pull request through CI.

## Read first

- [scripts guide](../scripts/AGENTS.md)

## Scope

The gate's gateway rejects each service's first payload with a 503 and requires the retry to match it byte for byte. The jobs host runs with a 500 ms deadline covering the retry. If a slow machine overruns it, the retry never comes and the next batch has different bytes. The old check then failed every later request with a 500, until the wait at line 92 timed out. Now a payload that differs gets its own 503 rejection, and only a byte-identical retry goes through.

## Out of scope

The exporter and reader in `packages/observability`, which behaved as designed. Other gates.

## Acceptance checks

- `node scripts/verify-otlp-metrics.mjs` exits 0.
- A forced overrun of the jobs host's first export fails the old gate and passes the new one.
- A retry with changed bytes fails the new gate.

## Evidence

31 October 2026, macOS ARM64, Node 20.19.4, with temporary copies of the gate that were then deleted.

- Hosted CI run 41196143582 failed once at line 92 with `Metric gate condition timed out`. The job passed in the five other runs checked, and no change touched this gate. The overrun was not observed directly on that hosted machine; the local reproduction below fails at the same wait.
- Old gate, first jobs export stalled 700 ms: exit 1, `Metric gate condition timed out` at the same wait.
- New gate, same stall: exit 0.
- New gate, the second request altered by one trailing space to imitate a changed retry: exit 1, in the Node fixture.
- Real gate with this change, three runs: exit 0 each time.

The first attempts hung because a new worktree downloads the collector and that download did not finish. They were stopped and are not counted. The runs above used the checksum-verified archive from the main checkout's cache. Hosted CI has not run this change yet.
