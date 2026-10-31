---
id: task006
title: Deploy one app to a real host and write down how
status: backlog
paths:
  - docs/deploy/
depends:
  - task003
---

## Goal

A developer can put a LongHorn app on the internet by following one guide. Every proof
so far runs locally, and the docs say that cloud deployment is unverified.

## Owner direction

None yet.

## Read first

- [Command app deployment](../docs/command-app-deployment.md)
- [D1 deployment](../docs/d1-deployment.md)

## Scope

Start with the D1 starter on real Cloudflare Workers, the shortest path to something
live. Then a Dockerfile and hosted PostgreSQL for the command app. There is no
Dockerfile in the repository today.

## Acceptance checks

A deployed URL serves a real request, and the docs record what was deployed and when.

## Evidence
