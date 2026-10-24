import{fileURLToPath}from'node:url'
export const buildOptions={absWorkingDir:fileURLToPath(new URL('.',import.meta.url)),entryPoints:['src/index.ts','src/deploy.ts','src/config.ts'],outdir:'dist',bundle:true,format:'esm',platform:'browser',target:'es2022',logOverride:{'ignored-bare-import':'silent'}}
