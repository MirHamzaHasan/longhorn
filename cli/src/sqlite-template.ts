import{readAssetTemplate}from'./asset-template.js'
export function readSqliteTemplate(framework:string,runtime:'node'|'bun'|'deno'='node'){
  if(runtime==='deno')return readAssetTemplate(framework,{
    name:'sqlite-tasks',assetName:'deno-sqlite-tasks',label:'Deno SQLite',runtime:'deno',allowBuilds:['esbuild','deno'],
    requiredFiles:['README.md','build.mjs','build.config.mjs','dev.mjs','host.mjs','start.mjs','build-tests.mjs','tests/runner.ts','tests/run-persistence.mjs','tests/processes.mjs','tests/permissions.mjs','src/index.ts','src/app.ts','src/config.ts','src/tasks.ts','src/storage.ts','src/sqlite-tasks.ts','src/task-events.ts','src/task-cache.ts','src/storage.test.ts','tests/persistence.mjs','docs/features.md'],
    requiredDependencies:['@longhornjs/core','@longhornjs/container','@longhornjs/config','@longhornjs/database','@longhornjs/deno','@longhornjs/http','@longhornjs/logger','@longhornjs/validation','@longhornjs/events','@longhornjs/cache'],
    scripts:{dev:'node dev.mjs',build:'node build.mjs',start:'node start.mjs',typecheck:'tsc --noEmit',test:'node build-tests.mjs && deno test --no-prompt --no-lock --node-modules-dir=manual --allow-read --allow-write --allow-net=127.0.0.1 --allow-env .test-dist','test:persistence':'pnpm build && node tests/run-persistence.mjs'},
  })
  if(runtime==='bun')return readAssetTemplate(framework,{
    name:'sqlite-tasks',assetName:'bun-sqlite-tasks',label:'Bun SQLite',runtime:'bun',allowBuilds:['esbuild','bun'],
    requiredFiles:['README.md','build.mjs','build.config.mjs','dev.mjs','src/index.ts','src/app.ts','src/config.ts','src/tasks.ts','src/storage.ts','src/sqlite-tasks.ts','src/task-events.ts','src/task-cache.ts','src/storage.test.ts','tests/persistence.mjs','docs/features.md'],
    requiredDependencies:['@longhornjs/core','@longhornjs/container','@longhornjs/config','@longhornjs/database','@longhornjs/bun','@longhornjs/http','@longhornjs/logger','@longhornjs/validation','@longhornjs/events','@longhornjs/cache'],
    scripts:{dev:'node dev.mjs',build:'node build.mjs',start:'bun dist/index.js',typecheck:'tsc --noEmit',test:'bun test ./src','test:persistence':'pnpm build && bun tests/persistence.mjs'},
  })
  return readAssetTemplate(framework,{
  name:'sqlite-tasks',label:'SQLite',runtime:'node',allowBuilds:['esbuild'],
  requiredFiles:['README.md','build.mjs','build.config.mjs','src/index.ts','src/app.ts','src/config.ts','src/tasks.ts','src/storage.ts','src/sqlite-tasks.ts','src/task-events.ts','src/task-cache.ts','tests/persistence.mjs','docs/features.md'],
  requiredDependencies:['@longhornjs/core','@longhornjs/container','@longhornjs/config','@longhornjs/database','@longhornjs/node','@longhornjs/http','@longhornjs/logger','@longhornjs/validation','@longhornjs/events','@longhornjs/cache'],
  scripts:{dev:'tsx watch src/index.ts',build:'node build.mjs',start:'node dist/index.js',typecheck:'tsc --noEmit',test:'vitest run','test:persistence':'pnpm build && node tests/persistence.mjs'},
})}
