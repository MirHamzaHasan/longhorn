# cli and create-longhorn

`@longhornjs/cli` holds the commands and generator. `create-longhorn` is the
creation-only entrypoint and shares its options. Guides: [docs/cli.md](../docs/cli.md)
and [docs/project-generation.md](../docs/project-generation.md).

- `scripts/snapshot.mjs` copies built packages and starters into `dist/framework`.
  Generated apps depend on that snapshot, not on this repository.
- Each template lists its files in `src/*-template.ts`. Files must be declared there
  and in `src/generator.test.ts`, or generation fails.
- The descriptor `schemaVersion` is 1. Do not change it casually.
- Nothing is published, so never document `npx create-longhorn` as available yet.
- Test with `pnpm vitest run cli` and then the packed-project gates, because a unit
  pass does not prove a relocated install: `pnpm test:projects`,
  `pnpm test:sqlite-project`, `pnpm test:d1-project`, `pnpm test:auth-project`,
  `pnpm test:command-project`.
