import { build } from 'esbuild'
import { rm } from 'node:fs/promises'
await rm('dist', { recursive: true, force: true })
await build({entryPoints:['src/operator-host.ts','src/migrate-operations.ts','src/operator-role.ts','src/runtime-grants.ts'],outdir:'dist',bundle:true,packages:'external',format:'esm',platform:'node',target:'node20',sourcemap:true})
await build({entryPoints:['console/app.ts'],outdir:'dist/console',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,sourcemap:true})
await build({entryPoints:['receiver/receiver.ts'],outdir:'dist/receiver',bundle:true,format:'esm',platform:'browser',target:'es2022',logOverride:{'ignored-bare-import':'silent'}})
