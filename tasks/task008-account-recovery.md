---
id: task008
title: Add account recovery and password reset
status: done
paths:
  - packages/auth/src/
  - runtimes/node/src/password-reset.test.ts
  - examples/auth/src/
  - scripts/verify-password-reset.mjs
  - scripts/verify-auth.mjs
  - scripts/verify-auth-project.mjs
  - docs/password-reset.md
  - docs/authentication.md
  - AGENTS.md
shared:
  - package.json
  - .github/workflows/verify.yml
  - docs/features.md
depends:
  - task003
---

## Goal

A user who forgets a password can get back in. This is the largest gap for anyone
building a real product on the auth module; the roadmap lists recovery, reset and MFA
as not implemented.

## Owner direction

1 November 2026: "ok think lets start on new features bro and keep on doing good amount of features we can add to make it more mature".

## Read first

- [Authentication](../docs/authentication.md)
- [Session fencing](../docs/password-session-fencing.md)

## Scope

Password reset first. Delivery is a function the application supplies, because LongHorn holds no contact details and has no email integration. Recovery without a known contact, email verification and MFA stay out of scope.

## Evidence

1 November 2026, macOS ARM64, Node 20.19.4. Unit and HTTP tests pass, and `verify-password-reset` exits 0 on real SQLite and PostgreSQL as a restricted role. See [password reset](../docs/password-reset.md) for what it covers and its limits. Bun, Deno, D1 and Durable Object SQLite did not run. README rows that say there is no password reset belong to active task020.
