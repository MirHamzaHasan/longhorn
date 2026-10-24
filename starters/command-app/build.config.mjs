import { fileURLToPath } from 'node:url'
const absWorkingDir = fileURLToPath(new URL('.', import.meta.url))
export const appBuild = { absWorkingDir, entryPoints: ['src/operator-host.ts','src/migrate-operations.ts','src/operator-role.ts','src/runtime-grants.ts'],
  outdir: 'dist', bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node20', sourcemap: true }
export const consoleBuild = { absWorkingDir, entryPoints: ['console/app.ts'], outdir: 'dist/console',
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, sourcemap: true }
export const receiverBuild = { absWorkingDir, entryPoints: ['receiver/receiver.ts'], outdir: 'dist/receiver',
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', logOverride: { 'ignored-bare-import': 'silent' } }
