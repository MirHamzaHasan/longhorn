import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm, cp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url)), temporary = await mkdtemp(join(tmpdir(), 'longhorn-prune-packages-'))
async function run(binary, args, cwd) {
  const child = spawn(binary, args, { cwd, env: { ...process.env, CI: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] }); let output = ''
  child.stdout.on('data', data => { output += data }); child.stderr.on('data', data => { output += data })
  const ended = new Promise((done, reject) => { child.once('error', reject); child.once('close', code => done(code)) }), timer = setTimeout(() => child.kill('SIGKILL'), 60000)
  try { assert.equal(await ended, 0, output); return output } finally { clearTimeout(timer) }
}
try {
  const source = join(temporary, 'consumer'), archives = join(source, 'packages'); await mkdir(archives, { recursive: true })
  const names = ['runtime', 'database', 'ratelimit', 'idempotency'], dependencies = {}
  for (const name of names) {
    const manifest = JSON.parse(await readFile(join(root, 'packages', name, 'package.json'), 'utf8'))
    await run('pnpm', ['pack', '--pack-destination', archives], join(root, 'packages', name))
    dependencies[manifest.name] = 'file:packages/longhorn-' + name + '-' + manifest.version + '.tgz'
  }
  await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'independent-prune-consumer', private: true, type: 'module', packageManager: 'pnpm@12.6.0', dependencies, pnpm: { overrides: dependencies } }, null, 2))
  await writeFile(join(source, 'pnpm-workspace.yaml'), 'packages: []\noverrides:\n' + Object.entries(dependencies).map(([name, value]) => '  "' + name + '": "' + value + '"').join('\n') + '\n')
  await writeFile(join(source, 'proof.mjs'), `import assert from 'node:assert/strict'
import { PruneWorker } from '@longhorn/runtime/prune-worker'
import { RateLimiter } from '@longhorn/ratelimit'
import { RateLimitCleanup } from '@longhorn/ratelimit/cleanup'
import { MemoryRateLimitStore } from '@longhorn/ratelimit/memory'
import { IdempotencyCleanup } from '@longhorn/idempotency/cleanup'
let now=100;const limiter=new RateLimiter({scope:'packed',store:new MemoryRateLimitStore(),windowMs:1000,now:()=>now});await limiter.consume('expired');now=1100
const cleanup=new RateLimitCleanup(limiter,{intervalMs:5});assert.ok(cleanup instanceof PruneWorker);cleanup.start();const end=Date.now()+5000;while(cleanup.snapshot().removed!==1){assert.ok(Date.now()<end);await new Promise(done=>setTimeout(done,1))}await cleanup.close();assert.equal((await limiter.consume('expired')).allowed,true);await limiter.close()
let runs=0;const previous=new IdempotencyCleanup({prune:async()=>{runs++;return 0}},{intervalMs:5});assert.ok(previous instanceof PruneWorker);previous.start();await new Promise(done=>setTimeout(done,10));await previous.close();assert.ok(runs>=1)
console.log('Independent packed cleanup exports and shared ownership pass.')
`)
  await writeFile(join(source, 'proof.ts'), `import { PruneWorker } from '@longhorn/runtime/prune-worker'
import { RateLimitCleanup } from '@longhorn/ratelimit/cleanup'
import { IdempotencyCleanup } from '@longhorn/idempotency/cleanup'
const pruner={prune:async(_limit:number)=>0}
const owners:PruneWorker[]=[new RateLimitCleanup(pruner),new IdempotencyCleanup(pruner)]
for(const owner of owners)void owner.close()
`)
  await writeFile(join(source, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noEmit: true, strict: true, module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', lib: ['ES2022', 'DOM'], types: [] }, files: ['proof.ts'] }))
  await run('pnpm', ['install', '--no-frozen-lockfile', '--offline', '--ignore-scripts'], source)
  const relocated = join(temporary, 'relocated'); await cp(source, relocated, { recursive: true, filter: path => !path.split('/').includes('node_modules') })
  await rm(source, { recursive: true, force: true }); await run('pnpm', ['install', '--frozen-lockfile', '--offline', '--ignore-scripts'], relocated)
  await run(process.execPath, [join(root, 'node_modules/typescript/lib/tsc.js'), '--project', 'tsconfig.json'], relocated)
  await run(process.execPath, ['proof.mjs'], relocated)
  await mkdir(join(root, '.artifacts'), { recursive: true }); await writeFile(join(root, '.artifacts/prune-package-proof.json'), JSON.stringify({ actualPnpmArchives: names, independentOfflineInstall: true, frozenRelocation: true, runtimeExports: true, declarations: true, idempotencyCompatibility: true, actualExpiredBucketRemoved: true }, null, 2) + '\n')
  console.log('Prune distribution: actual package archives, independent offline/frozen relocated install, declaration resolution, shared owner and expired memory bucket pass.')
} finally { await rm(temporary, { recursive: true, force: true }) }
