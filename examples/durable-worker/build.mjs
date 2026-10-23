import { build } from 'esbuild'
import { rm } from 'node:fs/promises'
await rm('dist',{ recursive: true,force: true })
await build({ entryPoints: ['src/index.ts','src/alarms.ts'],outdir: 'dist',bundle: true,format: 'esm',platform: 'browser',target: 'es2022',
  // tsup split outputs include redundant bare imports of side-effect-free chunks.
  logOverride: { 'ignored-bare-import': 'silent' },
})
