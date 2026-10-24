import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, basename } from 'node:path'
import { createHash } from 'node:crypto'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = fileURLToPath(new URL('../dist/framework/', import.meta.url))
const directories = [
  'packages/container', 'packages/runtime', 'packages/http', 'packages/logger', 'packages/events', 'packages/cache',
  'packages/validation', 'packages/config', 'packages/database', 'packages/auth', 'packages/core', 'packages/queue', 'packages/scheduler', 'packages/observability', 'packages/idempotency',
  'packages/ratelimit', 'packages/outbox', 'runtimes/node', 'runtimes/bun', 'runtimes/deno', 'runtimes/workers',
]
const entries = await Promise.all(directories.map(async (directory) => ({
  directory, package: JSON.parse(await readFile(join(root, directory, 'package.json'), 'utf8')),
})))
const versions = Object.fromEntries(entries.map((entry) => [entry.package.name, entry.package.version]))
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
const packages = {}
for (const entry of entries) {
  const { name, version, type, sideEffects, exports, engines } = entry.package
  const directory = name.slice('@longhorn/'.length)
  const destination = join(output, directory)
  const dependencies = Object.fromEntries(Object.entries(entry.package.dependencies ?? {}).map(([name, spec]) => [
    name, String(spec).startsWith('workspace:') ? versions[name] : spec,
  ]))
  if (Object.values(dependencies).some((value) => value === undefined)) throw new Error(`Missing workspace dependency for ${name}`)
  await mkdir(destination, { recursive: true })
  await cp(join(root, entry.directory, 'dist'), join(destination, 'dist'), { recursive: true })
  await writeFile(join(destination, 'package.json'), `${JSON.stringify({
    name, version, type, sideEffects, exports, engines, files: ['dist'], dependencies,
  }, null, 2)}\n`)
  packages[name] = { directory, dependencies }
}
await writeFile(join(output, 'manifest.json'), `${JSON.stringify({ packages }, null, 2)}\n`)

// Bundle editable application source, not links back into this checkout.
const template=join(output,'templates/d1-tasks')
await cp(join(root,'starters/d1-tasks'),template,{recursive:true})
await cp(join(root,'examples/d1-worker/src'),join(template,'src'),{recursive:true})
await cp(join(root,'examples/d1-worker/wrangler.example.toml'),join(template,'wrangler.example.toml'))
await cp(join(root,'LICENSE'),join(template,'LICENSE'))
let host=await readFile(join(root,'scripts/serve-d1-worker.mjs'),'utf8')
for(const[from,to]of[
  ["'../packages/runtime/dist/index.js'","'@longhorn/runtime'"],
  ["'../packages/config/dist/index.js'","'@longhorn/config'"],
  ["'../examples/d1-worker/dist/config.js'","'./dist/config.js'"],
  ["'../examples/d1-worker/dist/index.js'","'./dist/index.js'"],
  ["'../examples/d1-worker/dist/deploy.js'","'./dist/deploy.js'"],
  ["'../examples/d1-worker/data/d1'","'./data/d1'"],
  ["'3016'","'3000'"],
]){if(host.split(from).length!==2)throw new Error('D1 development host source changed; review template mapping');host=host.replace(from,to)}
await writeFile(join(template,'serve.mjs'),host)
const example=JSON.parse(await readFile(join(root,'examples/d1-worker/package.json'),'utf8'))
const hashes={}
async function record(directory,prefix='',target=hashes){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=prefix+entry.name
    if(entry.isDirectory())await record(join(directory,entry.name),path+'/',target)
    else if(entry.isFile())target[path]=createHash('sha256').update(await readFile(join(directory,entry.name))).digest('hex')
    else throw new Error('D1 template assets must be regular files')
  }
}
await record(template)
await writeFile(join(template,'template.json'),JSON.stringify({schemaVersion:1,dependencies:{...example.dependencies,'@longhorn/runtime':'workspace:*'},devDependencies:{...example.devDependencies,'@types/node':'^22.13.10',typescript:'^5.8.2',vitest:'^3.1.1',miniflare:'3.20250718.3'},files:hashes},null,2)+'\n')

const sqlite=join(output,'templates/sqlite-tasks')
await cp(join(root,'starters/sqlite-tasks'),sqlite,{recursive:true})
await cp(join(root,'examples/basic/src'),join(sqlite,'src'),{recursive:true,filter:path=>!basename(path).startsWith('redis-')})
await cp(join(root,'examples/basic/.env.example'),join(sqlite,'.env.example'))
await cp(join(root,'LICENSE'),join(sqlite,'LICENSE'))
let persistence=await readFile(join(root,'scripts/verify-persistence.mjs'),'utf8')
for(const[from,to]of[["'../runtimes/node/dist/sqlite.js'","'@longhorn/node/sqlite'"],["'examples/basic/dist/index.js'","'dist/index.js'"]]){
  if(persistence.split(from).length!==2)throw new Error('SQLite persistence gate changed; review template mapping')
  persistence=persistence.replace(from,to)
}
await mkdir(join(sqlite,'tests'),{recursive:true});await writeFile(join(sqlite,'tests/persistence.mjs'),persistence)
const basic=JSON.parse(await readFile(join(root,'examples/basic/package.json'),'utf8')),sqliteHashes={}
await record(sqlite,'',sqliteHashes)
await writeFile(join(sqlite,'template.json'),JSON.stringify({schemaVersion:1,dependencies:basic.dependencies,devDependencies:{...basic.devDependencies,typescript:'^5.8.2',vitest:'^3.1.1',esbuild:'^0.28.2'},files:sqliteHashes},null,2)+'\n')

// Runtime is a separate selection from the SQLite application template.
const bunSqlite=join(output,'templates/bun-sqlite-tasks')
await cp(join(root,'starters/bun-sqlite-tasks'),bunSqlite,{recursive:true})
await mkdir(join(bunSqlite,'src'),{recursive:true})
for(const entry of await readdir(join(root,'examples/basic/src'),{withFileTypes:true})){
  if(!entry.isFile())throw new Error('Basic source layout changed; review Bun template mapping')
  if(entry.name.startsWith('redis-')||['index.ts','storage.ts'].includes(entry.name))continue
  let source=await readFile(join(root,'examples/basic/src',entry.name),'utf8')
  if(entry.name.endsWith('.test.ts')){
    if(source.split("from 'vitest'").length!==2)throw new Error('Basic test runner changed; review Bun template mapping')
    source=source.replace("from 'vitest'","from 'bun:test'")
    source=source.replaceAll("'@longhorn/node/sqlite'","'@longhorn/bun/sqlite'").replaceAll("'@longhorn/node'","'@longhorn/bun'").replaceAll('nodeRuntime','bunRuntime').replaceAll('real Node server','real Bun server')
    if(entry.name==='cache.test.ts'){
      if(source.split('vi.mocked(store.counts)').length!==4)throw new Error('Cache test mocks changed; review Bun template mapping')
      source="import type { Mock } from 'bun:test'\n"+source.replaceAll('vi.mocked(store.counts)','mockedCounts(store)')+"\nfunction mockedCounts(store:TasksStore):Mock<TasksStore['counts']>{return store.counts as Mock<TasksStore['counts']>}\n"
    }
  }
  if(source.includes('@longhorn/node')||source.includes("from 'vitest'"))throw new Error('Unexpected Node-only import in Bun task source')
  await writeFile(join(bunSqlite,'src',entry.name),source)
}
for(const entry of['index.ts','storage.ts']){
  let source=await readFile(join(root,'examples/bun-sqlite/src',entry),'utf8')
  const matches=[...source.matchAll(/'\.\.\/\.\.\/basic\/src\/([a-z-]+\.js)'/g)]
  if(matches.length!==(entry==='index.ts'?2:4))throw new Error('Bun task source paths changed; review template mapping')
  source=source.replace(/'\.\.\/\.\.\/basic\/src\/([a-z-]+\.js)'/g,"'./$1'")
  await writeFile(join(bunSqlite,'src',entry),source)
}
await cp(join(root,'examples/basic/.env.example'),join(bunSqlite,'.env.example'))
await cp(join(root,'LICENSE'),join(bunSqlite,'LICENSE'))
await mkdir(join(bunSqlite,'tests'),{recursive:true})
await writeFile(join(bunSqlite,'tests/persistence.mjs'),persistence.replace("'@longhorn/node/sqlite'","'@longhorn/bun/sqlite'"))
const bunExample=JSON.parse(await readFile(join(root,'examples/bun-sqlite/package.json'),'utf8')),bunHashes={}
await record(bunSqlite,'',bunHashes)
await writeFile(join(bunSqlite,'template.json'),JSON.stringify({schemaVersion:1,dependencies:bunExample.dependencies,devDependencies:{'@types/bun':'1.4.4','bun-runtime':'npm:bun@1.4.4',typescript:'^5.8.2',esbuild:'^0.28.2'},files:bunHashes},null,2)+'\n')

const denoSqlite=join(output,'templates/deno-sqlite-tasks')
await cp(join(root,'starters/deno-sqlite-tasks'),denoSqlite,{recursive:true})
await mkdir(join(denoSqlite,'src'),{recursive:true})
let denoTestCount=0
for(const entry of await readdir(join(root,'examples/basic/src'),{withFileTypes:true})){
  if(!entry.isFile())throw new Error('Basic source layout changed; review Deno template mapping')
  if(entry.name.startsWith('redis-')||['index.ts','storage.ts'].includes(entry.name))continue
  let source=await readFile(join(root,'examples/basic/src',entry.name),'utf8')
  if(entry.name.endsWith('.test.ts')){
    denoTestCount++
    if(source.split("from 'vitest'").length!==2)throw new Error('Basic test runner changed; review Deno template mapping')
    source=source.replace("from 'vitest'","from '../tests/runner.js'")
    source=source.replaceAll("'@longhorn/node/sqlite'","'@longhorn/deno/sqlite'").replaceAll("'@longhorn/node'","'@longhorn/deno'").replaceAll('nodeRuntime','denoRuntime').replaceAll('real Node server','real Deno server')
    if(entry.name==='cache.test.ts'){
      const before='create: vi.fn(async (title)'
      if(source.split(before).length!==2)throw new Error('Cache mock signature changed; review Deno template mapping')
      source=source.replace(before,"create: vi.fn<TasksStore['create']>(async (title)")
    }
  }
  if(source.includes('@longhorn/node')||source.includes("from 'vitest'"))throw new Error('Unexpected Node adapter/test runner import in Deno task source')
  await writeFile(join(denoSqlite,'src',entry.name),source)
}
if(denoTestCount!==6)throw new Error('Deno application test set changed; review template mapping')
for(const entry of['index.ts','storage.ts']){
  let source=await readFile(join(root,'examples/deno-sqlite/src',entry),'utf8')
  const matches=[...source.matchAll(/'\.\.\/\.\.\/basic\/src\/([a-z-]+\.js)'/g)]
  if(matches.length!==(entry==='index.ts'?2:4))throw new Error('Deno task source paths changed; review template mapping')
  source=source.replace(/'\.\.\/\.\.\/basic\/src\/([a-z-]+\.js)'/g,"'./$1'")
  if(entry==='index.ts'){
    if(source.split("{ PORT: '3017' }, environment").length!==2)throw new Error('Deno task default port changed; review template mapping')
    source=source.replace("{ PORT: '3017' }, environment",'environment')
  }
  await writeFile(join(denoSqlite,'src',entry),source)
}
await cp(join(root,'examples/basic/.env.example'),join(denoSqlite,'.env.example'))
await cp(join(root,'LICENSE'),join(denoSqlite,'LICENSE'))
let denoPersistence=persistence.replace("'@longhorn/node/sqlite'","'@longhorn/deno/sqlite'")
for(const declaration of ["import { spawn } from 'node:child_process'\n","import { once } from 'node:events'\n","import { createInterface } from 'node:readline'\n"]){
  if(denoPersistence.split(declaration).length!==2)throw new Error('Deno persistence imports changed; review mapping')
  denoPersistence=denoPersistence.replace(declaration,'')
}
const hostStart='async function start() {',hostEnd='async function request('
if(denoPersistence.split(hostStart).length!==2||denoPersistence.split(hostEnd).length!==2)throw new Error('Deno persistence host ownership changed; review mapping')
denoPersistence=denoPersistence.slice(0,denoPersistence.indexOf(hostStart))+denoPersistence.slice(denoPersistence.indexOf(hostEnd))
if(denoPersistence.split('const processes = new Set()').length!==2)throw new Error('Deno persistence process set changed; review mapping')
denoPersistence="import { createHosts } from './processes.mjs'\n"+denoPersistence.replace('const processes = new Set()','const hosts = createHosts({ root, directory, filename })\nconst { start, stop } = hosts')
const cleanup='} finally {\n  await Promise.all([...processes].map'
if(denoPersistence.split(cleanup).length!==2)throw new Error('Deno persistence cleanup changed; review mapping')
denoPersistence=denoPersistence.slice(0,denoPersistence.indexOf(cleanup))+"} finally {\n  try { await hosts.close() } finally { await rm(directory, { recursive: true, force: true }) }\n}\n"
await writeFile(join(denoSqlite,'tests/persistence.mjs'),denoPersistence)
const denoExample=JSON.parse(await readFile(join(root,'examples/deno-sqlite/package.json'),'utf8')),denoHashes={}
await record(denoSqlite,'',denoHashes)
await writeFile(join(denoSqlite,'template.json'),JSON.stringify({schemaVersion:1,dependencies:denoExample.dependencies,devDependencies:{'@types/deno':'2.7.0','@types/node':'^22.13.10','deno-runtime':'npm:deno@2.9.6',expect:'30.5.2','jest-mock':'30.5.2',typescript:'^5.8.2',esbuild:'^0.28.2'},files:denoHashes},null,2)+'\n')

// Auth is the same real application on each native runtime, with an explicit host selection.
const authExample = JSON.parse(await readFile(join(root, 'examples/auth/package.json'), 'utf8'))
for (const runtime of ['node', 'bun', 'deno']) {
  const target = join(output, 'templates', runtime + '-sqlite-auth')
  await cp(join(root, 'starters/sqlite-auth'), target, { recursive: true })
  await mkdir(join(target, 'src'), { recursive: true })
  for (const name of ['app.ts', 'config.ts', 'notes.ts', 'app.test.ts']) {
    let source = await readFile(join(root, 'examples/auth/src', name), 'utf8')
    if (name === 'app.test.ts' && runtime !== 'node') {
      if (source.split("from 'vitest'").length !== 2 || source.split("'@longhorn/node/sqlite'").length !== 2) throw new Error('Auth test source changed; review native mapping')
      source = source.replace("from 'vitest'", runtime === 'bun' ? "from 'bun:test'" : "from '../tests/runner.js'")
        .replace("'@longhorn/node/sqlite'", "'@longhorn/" + runtime + "/sqlite'")
    }
    if (runtime !== 'node' && (source.includes('@longhorn/node') || source.includes("from 'vitest'"))) throw new Error('Unexpected Node-only import in native auth source')
    await writeFile(join(target, 'src', name), source)
  }
  const entry = runtime === 'node' ? 'index.ts' : runtime + '.ts'
  const host = await readFile(join(root, 'examples/auth/src', entry), 'utf8')
  if (!host.includes("'@longhorn/" + runtime + "/passwords'") || !host.includes("'@longhorn/" + runtime + "/sqlite'")) throw new Error('Auth native host changed; review mapping')
  await writeFile(join(target, 'src/index.ts'), host)
  await cp(join(root, 'examples/auth/.env.example'), join(target, '.env.example'))
  await cp(join(root, 'LICENSE'), join(target, 'LICENSE'))
  const types = runtime === 'node' ? ['node'] : ['node', runtime]
  const tsconfig = JSON.parse(await readFile(join(root, 'starters/sqlite-tasks/tsconfig.json'), 'utf8'))
  tsconfig.compilerOptions.types = types; tsconfig.include.push('tests/**/*.ts')
  await writeFile(join(target, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2) + '\n')
  const devDependencies = { '@types/node': '^22.13.10', typescript: '^5.8.2', esbuild: '^0.28.2',
    ...(runtime === 'node' ? { vitest: '^3.1.1' } : runtime === 'bun'
      ? { '@types/bun': '1.4.4', 'bun-runtime': 'npm:bun@1.4.4' }
      : { '@types/deno': '2.7.0', 'deno-runtime': 'npm:deno@2.9.6', expect: '30.5.2', 'jest-mock': '30.5.2' }) }
  if (runtime === 'deno') {
    await cp(join(root, 'starters/deno-sqlite-tasks/build-tests.mjs'), join(target, 'build-tests.mjs'))
    await cp(join(root, 'starters/deno-sqlite-tasks/tests/runner.ts'), join(target, 'tests/runner.ts'))
    await cp(join(root, 'starters/deno-sqlite-tasks/tests/permissions.mjs'), join(target, 'tests/permissions.mjs'))
  }
  const dependencies = Object.fromEntries(Object.entries(authExample.dependencies).filter(([name]) =>
    !['@longhorn/node', '@longhorn/bun', '@longhorn/deno'].includes(name) || name === '@longhorn/' + runtime))
  const hashes = {}; await record(target, '', hashes)
  await writeFile(join(target, 'template.json'), JSON.stringify({ schemaVersion: 1, dependencies, devDependencies, files: hashes }, null, 2) + '\n')
}


// The archive and CLI consume one checked, editable command application template.
const command=join(output,'templates/command-app')
await cp(join(root,'starters/command-app'),command,{recursive:true})
await cp(join(root,'examples/postgres/src'),join(command,'src'),{recursive:true,filter:source=>!source.endsWith('.postgres.test.ts')})
await cp(join(root,'examples/postgres/console'),join(command,'console'),{recursive:true})
await cp(join(root,'LICENSE'),join(command,'LICENSE'))
await cp(join(root,'examples/postgres/.operator.env.example'),join(command,'.operator.env.example'))
await mkdir(join(command,'receiver'),{recursive:true})
for(const name of ['receiver.ts','receipts.ts','contracts.ts','message-effect.ts'])await cp(join(root,'examples/outbox-worker/src',name),join(command,'receiver',name))
let receiver=await readFile(join(root,'scripts/serve-message-receiver.mjs'),'utf8')
for(const[from,to]of[
  ["'../packages/auth/dist/bearer.js'","'@longhorn/auth/bearer'"],
  ["'../packages/runtime/dist/index.js'","'@longhorn/runtime'"],
  ["'../examples/outbox-worker/data/receiver'","'../data/receiver'"],
  ["'../examples/outbox-worker/dist/receiver.js'","'../dist/receiver/receiver.js'"],
]){
  if(receiver.split(from).length!==2)throw new Error('Command receiver host changed; review template mapping')
  receiver=receiver.replace(from,to)
}
await writeFile(join(command,'scripts/serve-receiver.mjs'),receiver)
const compiler={target:'ES2022',module:'ESNext',moduleResolution:'Bundler',lib:['ES2022','DOM'],types:['node'],strict:true,noEmit:true,skipLibCheck:true,verbatimModuleSyntax:true,noUncheckedIndexedAccess:true,exactOptionalPropertyTypes:true}
await writeFile(join(command,'tsconfig.json'),JSON.stringify({compilerOptions:compiler,include:['src/**/*.ts']},null,2)+'\n')
await writeFile(join(command,'console/tsconfig.json'),JSON.stringify({extends:'../tsconfig.json',compilerOptions:{types:[],lib:['ES2022','DOM','DOM.Iterable']},include:['./**/*.ts']},null,2)+'\n')
await writeFile(join(command,'receiver/tsconfig.json'),JSON.stringify({extends:'../tsconfig.json',compilerOptions:{types:[]},include:['./**/*.ts']},null,2)+'\n')
await writeFile(join(command,'.gitignore'),'node_modules/\ndist/\ndata/\n.env\n.env.*\n!.env.example\n.operator.env\n.operator.env.local\n.maintenance.env\n.maintenance.env.local\n*.tsbuildinfo\n')
const commandExample=JSON.parse(await readFile(join(root,'examples/postgres/package.json'),'utf8')),commandHashes={}
await record(command,'',commandHashes)
if(Object.keys(commandHashes).length>160)throw new Error('Command template exceeds the shared asset bound')
await writeFile(join(command,'template.json'),JSON.stringify({schemaVersion:1,dependencies:{...commandExample.dependencies,'@longhorn/workers':'workspace:*','@longhorn/runtime':'workspace:*',miniflare:'3.20250718.3'},devDependencies:{'@types/node':'^22.13.10','@cloudflare/workers-types':'^5.20261022.1',esbuild:'^0.28.2',typescript:'^5.8.2',vitest:'^3.1.1'},files:commandHashes},null,2)+'\n')
