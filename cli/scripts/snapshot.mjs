import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = fileURLToPath(new URL('../dist/framework/', import.meta.url))
const directories = [
  'packages/container', 'packages/runtime', 'packages/http', 'packages/logger', 'packages/events', 'packages/cache',
  'packages/validation', 'packages/config', 'packages/database', 'packages/auth', 'packages/core', 'packages/queue', 'packages/scheduler', 'packages/observability', 'packages/idempotency',
  'packages/outbox', 'runtimes/node', 'runtimes/bun', 'runtimes/deno', 'runtimes/workers',
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
async function record(directory,prefix=''){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=prefix+entry.name
    if(entry.isDirectory())await record(join(directory,entry.name),path+'/')
    else if(entry.isFile())hashes[path]=createHash('sha256').update(await readFile(join(directory,entry.name))).digest('hex')
    else throw new Error('D1 template assets must be regular files')
  }
}
await record(template)
await writeFile(join(template,'template.json'),JSON.stringify({schemaVersion:1,dependencies:{...example.dependencies,'@longhorn/runtime':'workspace:*'},devDependencies:{...example.devDependencies,'@types/node':'^22.13.10',typescript:'^5.8.2',vitest:'^3.1.1',miniflare:'3.20250718.3'},files:hashes},null,2)+'\n')
