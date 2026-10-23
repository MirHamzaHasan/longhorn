import { build } from 'esbuild'
import { rm } from 'node:fs/promises'

await rm('dist', { recursive: true, force: true })
await build({
  entryPoints: ['src/bun.ts', 'src/deno.ts'], outdir: 'dist', bundle: true,
  packages: 'external', format: 'esm', platform: 'neutral', target: 'es2022',
})
// A browser bundle is also a portability check: Node builtins must not enter this graph.
await build({
  entryPoints: ['src/worker.ts'], outfile: 'dist/worker.js', bundle: true,
  format: 'esm', platform: 'browser', target: 'es2022',
})
