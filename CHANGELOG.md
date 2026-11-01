# Changelog

## Unreleased

- `create-longhorn`: every `--template` choice now generates from the npm packages. In 0.1.0 they failed, because npm renames `.gitignore` when it installs a package.

## 0.1.0, 31 October 2026

The first version on npm. APIs can still change.

- Application core, dependency injection and Hono HTTP, with native hosts for Node, Bun, Deno and Cloudflare Workers.
- Optional modules for configuration, validation, SQL databases, auth, events, caching, queues, schedules, idempotency, request limits, outbox delivery and observability.
- `create-longhorn` project generator and the `longhorn` CLI.

See [what is and isn't tested](README.md#what-is-and-isnt-tested) for the limits of this release.
