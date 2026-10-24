import { readAssetTemplate } from './asset-template.js'

/** The complete Node/PostgreSQL application; the receiver is an explicit second host. */
export async function readCommandTemplate(framework: string) {
  const template = await readAssetTemplate(framework, {
    name: 'command-app', label: 'Command application', runtime: 'node',
    allowBuilds: ['esbuild', 'workerd'],
    requiredFiles: ['README.md', 'LICENSE', 'build.mjs', 'build.config.mjs', 'dev.mjs', 'dev-host.mjs', 'tsconfig.json', 'console/tsconfig.json', 'receiver/tsconfig.json',
      '.operator.env.example', 'scripts/serve-receiver.mjs', 'scripts/provision-runtime.mjs', 'scripts/state-backup.mjs',
      'src/app.ts', 'src/operator-host.ts', 'src/operator-check.ts', 'src/operator-preflight.ts', 'src/operator-environment.ts', 'src/postgres-readiness.ts', 'src/operator-config.ts', 'src/operator-runtime.ts',
      'src/operations.ts', 'src/operations-migrations.ts', 'src/runtime-grants.ts', 'src/accounts.ts',
      'src/command-history.ts', 'src/history-views.ts', 'src/request-cleanup.ts',
      'console/app.ts', 'console/app.css', 'console/routes.ts', 'receiver/receiver.ts', 'receiver/receipts.ts',
      'receiver/contracts.ts', 'receiver/message-effect.ts', 'docs/features.md', 'docs/setup.md',
      'docs/deployment.md', 'docs/dependencies.md', 'docs/backup.md', 'docs/generation.md', 'docs/development.md', 'docs/preflight.md'],
    requiredDependencies: ['@longhorn/core', '@longhorn/container', '@longhorn/config', '@longhorn/database',
      '@longhorn/node', '@longhorn/auth', '@longhorn/http', '@longhorn/logger', '@longhorn/validation',
      '@longhorn/idempotency', '@longhorn/outbox', '@longhorn/queue', '@longhorn/scheduler',
      '@longhorn/observability', '@longhorn/workers', '@longhorn/runtime', 'hono', 'zod', 'miniflare'],
    scripts: {
      check: 'node dist/operator-check.js', build: 'node build.mjs', start: 'node dist/operator-host.js',
      dev: 'node dev.mjs', 'dev:receiver': 'node dev.mjs --receiver', receiver: 'node scripts/serve-receiver.mjs',
      migrate: 'node dist/migrate-operations.js', operator: 'node dist/operator-role.js',
      'provision:runtime': 'node scripts/provision-runtime.mjs',
      'state:backup': 'node scripts/state-backup.mjs backup', 'state:restore': 'node scripts/state-backup.mjs restore',
      typecheck: 'tsc --noEmit && tsc -p console/tsconfig.json --noEmit && tsc -p receiver/tsconfig.json --noEmit',
      test: 'vitest run',
    },
  })
  return {
    dependencies: template.dependencies,
    projectFiles(name: string, dependencies: Record<string, string>, locations: Record<string, string>) {
      const files = template.projectFiles(name, dependencies, locations)
      const manifest = JSON.parse(files['package.json']!)
      manifest.version = '0.1.0-dev'
      manifest.longhorn.application = 'commands'
      files['package.json'] = JSON.stringify(manifest, null, 2) + '\n'
      files['.longhorn/distribution.json'] = JSON.stringify({
        schemaVersion: 1, application: 'commands', frameworkPackages: Object.keys(locations).sort(),
      }, null, 2) + '\n'
      return files
    },
  }
}
