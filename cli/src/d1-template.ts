import{readAssetTemplate}from'./asset-template.js'
export function readD1Template(framework:string){return readAssetTemplate(framework,{
  name:'d1-tasks',label:'D1',runtime:'workers',allowBuilds:['esbuild','workerd'],
  requiredFiles:['README.md','build.mjs','build.config.mjs','serve.mjs','dev.mjs','src/index.ts','src/app.ts','src/deploy.ts','src/schema.ts','src/config.ts','src/tasks.ts','tests/storage.mjs','docs/features.md'],
  requiredDependencies:['@longhorn/core','@longhorn/container','@longhorn/config','@longhorn/database','@longhorn/idempotency','@longhorn/validation','@longhorn/workers','@longhorn/runtime'],
  scripts:{dev:'node dev.mjs',build:'node build.mjs',start:'node serve.mjs',typecheck:'tsc --noEmit',test:'vitest run','test:storage':'pnpm build && node tests/storage.mjs'},
})}
