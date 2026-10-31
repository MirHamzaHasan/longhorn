---
id: task008
title: Add account recovery and password reset
status: backlog
paths:
  - packages/auth/
depends:
  - task003
---

## Goal

A user who forgets a password can get back in. This is the largest gap for anyone
building a real product on the auth module; the roadmap lists recovery, reset and MFA
as not implemented.

## Owner direction

None yet. New feature work waits for the owner under the development pause.

## Read first

- [Authentication](../docs/authentication.md)
- [Session fencing](../docs/password-session-fencing.md)

## Scope

Decide with the owner how reset tokens reach the user; there is no email integration.

## Evidence
