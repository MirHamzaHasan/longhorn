import { readAssetTemplate } from './asset-template.js'

export function readAuthTemplate(framework: string, runtime: 'node' | 'bun' | 'deno') {
  return readAssetTemplate(framework, {
    name: 'sqlite-auth', assetName: `${runtime}-sqlite-auth`, label: `${runtime} SQLite auth`, runtime,
    allowBuilds: ['esbuild', ...(runtime === 'node' ? [] : [runtime])],
    requiredFiles: ['README.md', 'build.mjs', 'build.config.mjs', 'dev.mjs', 'host.mjs', 'start.mjs',
      'src/index.ts', 'src/app.ts', 'src/config.ts', 'src/notes.ts', 'src/app.test.ts',
      'tests/persistence.mjs', 'docs/features.md', 'docs/accounts.md', 'docs/passwords.md', 'docs/sessions.md',
      'docs/http.md', 'docs/notes.md', 'docs/configuration.md', 'docs/lifecycle.md', 'docs/migrations.md', 'docs/testing.md', 'docs/password-changes.md', 'docs/session-inventory.md',
      ...(runtime === 'deno' ? ['build-tests.mjs', 'tests/runner.ts', 'tests/permissions.mjs'] : [])],
    requiredDependencies: ['@longhorn/auth', '@longhorn/core', '@longhorn/container', '@longhorn/config',
      '@longhorn/database', `@longhorn/${runtime}`, '@longhorn/logger', '@longhorn/validation'],
    scripts: { dev: 'node dev.mjs', build: 'node build.mjs', start: 'node start.mjs', typecheck: 'tsc --noEmit',
      test: runtime === 'node' ? 'vitest run' : runtime === 'bun' ? 'bun test ./src'
        : 'node build-tests.mjs && deno test --no-prompt --no-lock --node-modules-dir=manual --allow-env .test-dist',
      'test:persistence': 'pnpm build && node tests/persistence.mjs' },
  })
}
