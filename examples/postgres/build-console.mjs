import { build } from 'esbuild'
await build({entryPoints:['console/app.ts'],outdir:'dist/console',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,sourcemap:true,logLevel:'warning'})
