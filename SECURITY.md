# Security policy

## Supported versions

LongHorn is pre-release and has no published packages. Fixes go to `main`.

## Report a vulnerability

**Please don't open a public issue.** Report it privately through
[GitHub's vulnerability reporting](https://github.com/MirHamzaHasan/longhorn/security/advisories/new).

Include what the problem is, how to reproduce it, and what an attacker could do with it.
You'll get a reply as soon as the maintainer can manage. This is a small project, so
there is no guaranteed response time. Please allow a reasonable time for a fix before
you disclose it publicly.

## In scope

Authentication, sessions, authorization, request replay, rate limits, delivery, audit
records, generated projects and the console.

## Out of scope

- Fake credentials in tests and example files, such as `postgres://user:secret@example.com`.
- Local demo hosts. They bind to loopback and aren't hardened for public networks.
- Problems that need an attacker to already control the server or database.
