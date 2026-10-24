import{readAssetTemplate}from'./asset-template.js'
export function readSqliteTemplate(framework:string){return readAssetTemplate(framework,{
  name:'sqlite-tasks',label:'SQLite',runtime:'node',allowBuilds:['esbuild'],
  requiredFiles:['README.md','build.mjs','build.config.mjs','src/index.ts','src/app.ts','src/config.ts','src/tasks.ts','src/storage.ts','src/sqlite-tasks.ts','src/task-events.ts','src/task-cache.ts','tests/persistence.mjs','docs/features.md'],
  requiredDependencies:['@longhorn/core','@longhorn/container','@longhorn/config','@longhorn/database','@longhorn/node','@longhorn/http','@longhorn/logger','@longhorn/validation','@longhorn/events','@longhorn/cache'],
  scripts:{dev:'tsx watch src/index.ts',build:'node build.mjs',start:'node dist/index.js',typecheck:'tsc --noEmit',test:'vitest run','test:persistence':'pnpm build && node tests/persistence.mjs'},
})}
