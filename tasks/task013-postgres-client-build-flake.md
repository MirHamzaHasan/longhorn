---
id: task013
title: Stop the PostgreSQL client build failing intermittently in CI
status: done
paths:
  - scripts/prepare-postgres-clients.mjs
shared:
depends:
---

## Goal

`prepare-postgres-clients` builds reliably on hosted Ubuntu, so the required `independent-distribution` job doesn't fail by chance.

## Owner direction

None. Found while confirming CI on `main`.

## Read first

- [scripts guide](../scripts/AGENTS.md)

## Scope

`prepare-postgres-clients` failed in 3 of the 12 hosted runs checked on 31 October 2026. Run 41215446439 on `2f6b25e` failed linking `pg_dump`, `pg_restore` and `pg_dumpall` with undefined references to `pg_encoding_to_char` and `pg_char_to_encoding`. Run 41214003996 on `81333de` failed in `submake-libpq` and `submake-libpgport` while make deleted `libpgcommon_excluded_shlib.a`. Run 41196120155 on `ac660f0` failed at the same step, but the log lines checked don't show why. Under `make -j4` those submakes can enter the same library directory at once, so the build now runs serially. A slower step is the cost.

## Out of scope

Other gates.

## Acceptance checks

`independent-distribution` passes repeatedly on hosted Ubuntu with the serial build. At the old failure rate of about 1 in 4, several clean runs in a row make the fix likely, but they don't prove it.

## Evidence

31 October 2026, hosted Ubuntu. Run 41218225332 on `70e9971`, with the serial build: `independent-distribution` passed 6 of 6 attempts. At the old rate of 3 failures in 12 runs, that makes the fix likely but does not prove it. The failure was not reproduced locally, because the source download timed out.
