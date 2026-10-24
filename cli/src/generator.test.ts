import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createProject } from './generator.js'
import { runtimes } from './templates.js'

let temporary: string
let framework: string
beforeEach(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'longhorn-generator-'))
  framework = join(temporary, 'distribution')
  const packages: Record<string, { directory: string; dependencies: Record<string, string> }> = {}
  for (const name of ['core', 'container', 'http', 'logger', 'runtime', 'config', 'validation', 'database', 'auth', 'idempotency', 'ratelimit', 'outbox', 'queue', 'scheduler', 'events', 'cache', 'observability', ...runtimes]) {
    const dependencies: Record<string, string> = name === 'core'
      ? { '@longhorn/container': '0.0.1', '@longhorn/http': '0.0.1', '@longhorn/logger': '0.0.1', '@longhorn/runtime': '0.0.1' }
      : name === 'node' ? { '@longhorn/database': '0.0.1', '@longhorn/config': '0.0.1', '@longhorn/auth':'0.0.1' } : ['bun','deno'].includes(name) ? {'@longhorn/database':'0.0.1','@longhorn/auth':'0.0.1'} : ['auth','idempotency'].includes(name) ? {'@longhorn/database':'0.0.1'} : {}
    const directory = join(framework, name)
    await mkdir(join(directory, 'dist'), { recursive: true })
    await writeFile(join(directory, 'dist/index.js'), `export const runtime = ${JSON.stringify(name)}\n`)
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: `@longhorn/${name}`, version: '0.0.1', dependencies }))
    packages[`@longhorn/${name}`] = { directory: name, dependencies }
  }
  await writeFile(join(framework, 'manifest.json'), JSON.stringify({ packages }))
})
afterEach(async () => { await rm(temporary, { recursive: true, force: true }) })

describe('project generation', () => {
  async function commandAssets() {
    const directory = join(framework, 'templates/command-app'), files: Record<string, string> = {}
    const paths = ['README.md', 'LICENSE', 'build.mjs', 'build.config.mjs', 'dev.mjs', 'dev-host.mjs', 'tsconfig.json', 'console/tsconfig.json', 'receiver/tsconfig.json',
      '.operator.env.example', '.maintenance.env.example', 'scripts/serve-receiver.mjs', 'scripts/provision-runtime.mjs', 'scripts/state-backup.mjs',
      'src/app.ts', 'src/operator-host.ts', 'src/operator-check.ts', 'src/operator-preflight.ts', 'src/operator-environment.ts', 'src/postgres-readiness.ts', 'src/operator-config.ts', 'src/operator-runtime.ts', 'src/operations.ts',
      'src/maintain-limits.ts', 'src/provision-limit-maintenance.ts', 'src/limit-maintenance.ts', 'src/limit-maintenance-config.ts', 'src/limit-maintenance-access.ts', 'src/limit-maintenance-grants.ts',
      'src/operations-migrations.ts', 'src/runtime-grants.ts', 'src/accounts.ts', 'src/command-history.ts',
      'src/history-views.ts', 'src/request-cleanup.ts', 'src/command-limits.ts', 'src/command-limit-migrations.ts', 'console/app.ts', 'console/app.css', 'console/routes.ts',
      'receiver/receiver.ts', 'receiver/receipts.ts', 'receiver/contracts.ts', 'receiver/message-effect.ts',
      'docs/features.md', 'docs/setup.md', 'docs/deployment.md', 'docs/dependencies.md', 'docs/backup.md', 'docs/generation.md', 'docs/development.md', 'docs/preflight.md', 'docs/request-limits.md', 'docs/limit-maintenance.md', 'docs/limit-maintenance-role.md', 'docs/limit-maintenance-report.md']
    for (const path of paths) {
      const target = join(directory, path), content = path === 'README.md' ? '# {{PROJECT_NAME}}\n' : 'editable command application asset\n'
      await mkdir(join(target, '..'), { recursive: true }); await writeFile(target, content)
      files[path] = createHash('sha256').update(content).digest('hex')
    }
    const descriptor = { schemaVersion: 1, dependencies: {
      ...Object.fromEntries(['core','container','config','database','node','auth','http','logger','validation',
        'idempotency','ratelimit','outbox','queue','scheduler','observability','workers','runtime'].map(name => ['@longhorn/'+name, 'workspace:*'])),
      hono: '^4.13.13', zod: '^4.6.7', miniflare: '3.20250718.3',
    }, devDependencies: { vitest: '^3.1.1' }, files }
    await writeFile(join(directory, 'template.json'), JSON.stringify(descriptor)); return { directory, descriptor }
  }
  it('creates the complete Node command profile with an explicit receiver and archive metadata', async () => {
    await commandAssets(); const directory = join(temporary, 'personal console')
    const project = await createProject({directory, name:'my-console', runtime:'node', template:'command-app', frameworkDirectory:framework})
    const manifest = JSON.parse(await readFile(join(directory,'package.json'),'utf8'))
    expect(manifest.longhorn).toEqual({schemaVersion:1,runtime:'node',framework:'snapshot',template:'command-app',application:'commands'})
    expect(manifest.scripts).toMatchObject({'maintain:limits':'node dist/maintain-limits.js','provision:limit-maintenance':'node dist/provision-limit-maintenance.js',check:'node dist/operator-check.js',dev:'node dev.mjs','dev:receiver':'node dev.mjs --receiver',start:'node dist/operator-host.js',receiver:'node scripts/serve-receiver.mjs',migrate:'node dist/migrate-operations.js','state:restore':'node scripts/state-backup.mjs restore'})
    expect(manifest.dependencies.miniflare).toBe('3.20250718.3'); expect(manifest.dependencies['@longhorn/outbox']).toBe('file:./.longhorn/framework/outbox')
    expect(project.packages).toContain('@longhorn/workers'); expect(project.packages).not.toContain('@longhorn/bun'); expect(project.packages).not.toContain('@longhorn/deno')
    expect(JSON.parse(await readFile(join(directory,'.longhorn/distribution.json'),'utf8'))).toEqual({schemaVersion:1,application:'commands',frameworkPackages:project.packages})
    expect(await readFile(join(directory,'README.md'),'utf8')).toBe('# my-console\n')
    expect(await readFile(join(directory,'pnpm-workspace.yaml'),'utf8')).toContain('workerd: true')
    expect(await readFile(join(directory,'src/runtime-grants.ts'),'utf8')).toBe('editable command application asset\n')
  })
  it('rejects a damaged command receiver before touching an existing empty destination', async () => {
    const assets=await commandAssets(),directory=join(temporary,'empty-console'); await mkdir(directory)
    await writeFile(join(assets.directory,'receiver/receiver.ts'),'damaged receiver')
    await expect(createProject({directory,runtime:'node',template:'command-app',frameworkDirectory:framework})).rejects.toThrow('Command application template assets are unavailable or invalid')
    expect(await readdir(directory)).toEqual([]);expect((await readdir(temporary)).some(name=>name.startsWith('.longhorn-create-'))).toBe(false)
  })
  it.each(['src/runtime-grants.ts','scripts/state-backup.mjs','receiver/receipts.ts','docs/setup.md','dev-host.mjs','docs/development.md','src/operator-check.ts','src/postgres-readiness.ts','docs/preflight.md'])('requires command deployment and receiver asset %s before staging', async path => {
    const assets=await commandAssets(),directory=join(temporary,'missing-console')
    delete assets.descriptor.files[path];await writeFile(join(assets.directory,'template.json'),JSON.stringify(assets.descriptor))
    await expect(createProject({directory,runtime:'node',template:'command-app',frameworkDirectory:framework})).rejects.toThrow('assets are unavailable or invalid')
    expect(await readdir(temporary)).toEqual(['distribution'])
  })
  it.each(['bun','deno','workers'] as const)('rejects %s command hosts before looking for assets or creating output', async runtime => {
    await expect(createProject({directory:join(temporary,'wrong-console'),runtime,template:'command-app',frameworkDirectory:join(temporary,'absent')})).rejects.toThrow('requires --runtime node')
    expect(await readdir(temporary)).toEqual(['distribution'])
  })

  async function authAssets(runtime: 'node' | 'bun' | 'deno') {
    const directory = join(framework, 'templates', runtime + '-sqlite-auth'), files: Record<string, string> = {}
    for (const path of ['README.md', 'build.mjs', 'build.config.mjs', 'dev.mjs', 'host.mjs', 'start.mjs',
      'src/index.ts', 'src/app.ts', 'src/config.ts', 'src/notes.ts', 'src/app.test.ts', 'tests/persistence.mjs',
      ...['features', 'accounts', 'passwords', 'sessions', 'http', 'notes', 'configuration', 'lifecycle', 'migrations', 'testing', 'password-changes'].map(name => 'docs/' + name + '.md'),
      ...(runtime === 'deno' ? ['build-tests.mjs', 'tests/runner.ts', 'tests/permissions.mjs'] : [])]) {
      const target = join(directory, path), content = path === 'README.md' ? '# {{PROJECT_NAME}}\n' : 'editable auth asset\n'
      await mkdir(join(target, '..'), { recursive: true }); await writeFile(target, content)
      files[path] = createHash('sha256').update(content).digest('hex')
    }
    const descriptor = { schemaVersion: 1, dependencies: Object.fromEntries(
      ['auth', 'core', 'container', 'config', 'database', runtime, 'logger', 'validation'].map(name => ['@longhorn/' + name, 'workspace:*'])),
      devDependencies: runtime === 'node' ? { vitest: '^3.1.1' } : { [runtime + '-runtime']: 'npm:' + runtime + '@' + (runtime === 'bun' ? '1.4.4' : '2.9.6') }, files }
    await writeFile(join(directory, 'template.json'), JSON.stringify(descriptor)); return { directory, descriptor }
  }
  it.each(['node', 'bun', 'deno'] as const)('generates selected %s native auth with its framework graph and source/native scripts', async runtime => {
    await authAssets(runtime); const directory = join(temporary, runtime + '-accounts')
    const project = await createProject({ directory, runtime, template: 'sqlite-auth', frameworkDirectory: framework })
    expect(project.packages).toContain('@longhorn/auth'); expect(project.packages).toContain('@longhorn/' + runtime)
    for (const other of runtimes.filter(value => value !== runtime)) expect(project.packages).not.toContain('@longhorn/' + other)
    expect(project.packages).not.toContain('@longhorn/cache')
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    expect(manifest.longhorn).toMatchObject({ runtime, template: 'sqlite-auth' })
    expect(manifest.scripts).toMatchObject({ dev: 'node dev.mjs', start: 'node start.mjs', 'test:persistence': 'pnpm build && node tests/persistence.mjs' })
    expect(manifest.scripts.test).toContain(runtime === 'node' ? 'vitest' : runtime === 'bun' ? 'bun test' : 'deno test')
    expect(await readFile(join(directory, 'README.md'), 'utf8')).toBe('# ' + runtime + '-accounts\n')
    expect(await readFile(join(directory, 'pnpm-workspace.yaml'), 'utf8')).toContain('file:./.longhorn/framework/auth')
  })
  it.each(['node', 'bun', 'deno'] as const)('rejects corrupted %s auth launch assets before staging a destination', async runtime => {
    const assets = await authAssets(runtime), directory = join(temporary, 'corrupt-auth')
    await writeFile(join(assets.directory, 'host.mjs'), 'corrupted native launch policy')
    await expect(createProject({ directory, runtime, template: 'sqlite-auth', frameworkDirectory: framework })).rejects.toThrow('SQLite auth template assets are unavailable or invalid')
    expect(await readdir(temporary)).toEqual(['distribution'])
  })
  it('rejects incomplete auth source and incompatible Workers selection without publishing', async () => {
    const assets = await authAssets('deno'), directory = join(temporary, 'incomplete-auth')
    delete assets.descriptor.files['src/app.test.ts']
    await writeFile(join(assets.directory, 'template.json'), JSON.stringify(assets.descriptor))
    await expect(createProject({ directory, runtime: 'deno', template: 'sqlite-auth', frameworkDirectory: framework })).rejects.toThrow('assets are unavailable or invalid')
    await expect(createProject({ directory, runtime: 'workers', template: 'sqlite-auth', frameworkDirectory: framework })).rejects.toThrow('requires --runtime node, bun or deno')
    expect(await readdir(temporary)).toEqual(['distribution'])
  })
  async function d1Assets(){
    const directory=join(framework,'templates/d1-tasks'),files:Record<string,string>={}
    for(const path of ['README.md','build.mjs','build.config.mjs','serve.mjs','dev.mjs','src/index.ts','src/app.ts','src/deploy.ts','src/schema.ts','src/config.ts','src/tasks.ts','src/request-limits.ts','tests/storage.mjs','docs/features.md','docs/request-limits.md']){
      const target=join(directory,path),content=path==='README.md'?'# {{PROJECT_NAME}}\n':'editable application asset\n'
      await mkdir(join(target,'..'),{recursive:true});await writeFile(target,content);files[path]=createHash('sha256').update(content).digest('hex')
    }
    const descriptor={schemaVersion:1,dependencies:Object.fromEntries(['core','container','config','database','idempotency','ratelimit','validation','workers','runtime'].map(name=>['@longhorn/'+name,'workspace:*'])),devDependencies:{miniflare:'3.20250718.3'},files}
    await writeFile(join(directory,'template.json'),JSON.stringify(descriptor));return {directory,descriptor}
  }
  async function sqliteAssets(runtime:'node'|'bun'|'deno'='node'){
    const directory=join(framework,'templates',runtime==='node'?'sqlite-tasks':runtime+'-sqlite-tasks'),files:Record<string,string>={}
    for(const path of ['README.md','build.mjs','build.config.mjs','src/index.ts','src/app.ts','src/config.ts','src/tasks.ts','src/storage.ts','src/sqlite-tasks.ts','src/task-events.ts','src/task-cache.ts','tests/persistence.mjs','docs/features.md',...(runtime!=='node'?['dev.mjs','src/storage.test.ts']:[]),...(runtime==='deno'?['host.mjs','start.mjs','build-tests.mjs','tests/runner.ts','tests/run-persistence.mjs','tests/processes.mjs','tests/permissions.mjs']:[])]){
      const target=join(directory,path),content=path==='README.md'?'# {{PROJECT_NAME}}\n':'editable SQLite application\n'
      await mkdir(join(target,'..'),{recursive:true});await writeFile(target,content);files[path]=createHash('sha256').update(content).digest('hex')
    }
    const descriptor={schemaVersion:1,dependencies:Object.fromEntries(['core','container','config','database',runtime,'http','logger','validation','events','cache'].map(name=>['@longhorn/'+name,'workspace:*'])),devDependencies:runtime==='bun'?{'bun-runtime':'npm:bun@1.4.4'}:runtime==='deno'?{'deno-runtime':'npm:deno@2.9.6'}:{tsx:'^4.20.0'},files}
    await writeFile(join(directory,'template.json'),JSON.stringify(descriptor));return {directory,descriptor}
  }
  it('selects the persistent Node application graph and its own native scripts',async()=>{
    await sqliteAssets();const directory=join(temporary,'persistent-node')
    const project=await createProject({directory,runtime:'node',template:'sqlite-tasks',frameworkDirectory:framework})
    expect(project.template).toBe('sqlite-tasks');expect(project.packages).toContain('@longhorn/cache');expect(project.packages).not.toContain('@longhorn/workers')
    const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'))
    expect(manifest.longhorn).toMatchObject({runtime:'node',template:'sqlite-tasks'});expect(manifest.scripts['test:persistence']).toContain('tests/persistence.mjs')
    expect(manifest.scripts.dev).toBe('tsx watch src/index.ts');expect(await readFile(join(directory,'pnpm-workspace.yaml'),'utf8')).not.toContain('workerd:')
  })
  it('selects Bun SQLite assets while retaining the public SQLite template identity',async()=>{
    await sqliteAssets('bun');const directory=join(temporary,'persistent-bun')
    const project=await createProject({directory,runtime:'bun',template:'sqlite-tasks',frameworkDirectory:framework})
    expect(project.packages).toContain('@longhorn/bun');expect(project.packages).toContain('@longhorn/database');expect(project.packages).not.toContain('@longhorn/node')
    const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'))
    expect(manifest.longhorn).toMatchObject({runtime:'bun',template:'sqlite-tasks'})
    expect(manifest.scripts).toMatchObject({dev:'node dev.mjs',start:'bun dist/index.js',test:'bun test ./src'})
    expect(manifest.devDependencies['bun-runtime']).toBe('npm:bun@1.4.4')
    expect(await readFile(join(directory,'pnpm-workspace.yaml'),'utf8')).toContain('bun: true')
  })
  it('requires Bun native source tests and verifies their hashes before publishing',async()=>{
    const assets=await sqliteAssets('bun'),directory=join(temporary,'corrupt-bun')
    await writeFile(join(assets.directory,'src/storage.test.ts'),'corrupted native source')
    await expect(createProject({directory,runtime:'bun',template:'sqlite-tasks',frameworkDirectory:framework})).rejects.toThrow('Bun SQLite template assets are unavailable or invalid')
    expect(await readdir(temporary)).toEqual(['distribution'])
  })
  it('selects native Deno storage and independent tooling under the same SQLite identity',async()=>{
    await sqliteAssets('deno');const directory=join(temporary,'persistent-deno')
    const project=await createProject({directory,runtime:'deno',template:'sqlite-tasks',frameworkDirectory:framework})
    expect(project.packages).toContain('@longhorn/deno');expect(project.packages).toContain('@longhorn/database')
    expect(project.packages).not.toContain('@longhorn/node');expect(project.packages).not.toContain('@longhorn/bun');expect(project.packages).not.toContain('@longhorn/workers')
    const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'))
    expect(manifest.longhorn).toMatchObject({runtime:'deno',template:'sqlite-tasks'})
    expect(manifest.scripts).toMatchObject({dev:'node dev.mjs',start:'node start.mjs',typecheck:'tsc --noEmit'})
    expect(manifest.scripts.test).toContain('deno test');expect(manifest.devDependencies['deno-runtime']).toBe('npm:deno@2.9.6')
    expect(await readFile(join(directory,'pnpm-workspace.yaml'),'utf8')).toContain('deno: true')
  })
  it('requires and verifies native Deno test assets before publishing',async()=>{
    const assets=await sqliteAssets('deno'),directory=join(temporary,'corrupt-deno')
    await writeFile(join(assets.directory,'tests/runner.ts'),'corrupted native test runner')
    await expect(createProject({directory,runtime:'deno',template:'sqlite-tasks',frameworkDirectory:framework})).rejects.toThrow('Deno SQLite template assets are unavailable or invalid')
    delete assets.descriptor.files['tests/runner.ts'];await writeFile(join(assets.directory,'template.json'),JSON.stringify(assets.descriptor))
    await expect(createProject({directory,runtime:'deno',template:'sqlite-tasks',frameworkDirectory:framework})).rejects.toThrow('Deno SQLite template assets are unavailable or invalid')
    expect(await readdir(temporary)).toEqual(['distribution'])
  })
  it('rejects incomplete SQLite assets and incompatible runtime choices before publishing',async()=>{
    const assets=await sqliteAssets(),directory=join(temporary,'refused-sqlite')
    delete assets.descriptor.files['src/storage.ts'];await writeFile(join(assets.directory,'template.json'),JSON.stringify(assets.descriptor))
    await expect(createProject({directory,runtime:'node',template:'sqlite-tasks',frameworkDirectory:framework})).rejects.toThrow('SQLite template assets are unavailable or invalid')
    await expect(createProject({directory,runtime:'workers',template:'sqlite-tasks',frameworkDirectory:framework})).rejects.toThrow('requires --runtime node, bun or deno')
    expect(await readdir(temporary)).toEqual(['distribution'])
  })
  it('selects the explicit D1 application graph and relocatable editable assets',async()=>{
    await d1Assets();const directory=join(temporary,'persistent')
    const project=await createProject({directory,name:'persistent-api',runtime:'workers',template:'d1-tasks',frameworkDirectory:framework})
    expect(project.template).toBe('d1-tasks');expect(project.packages).toContain('@longhorn/idempotency');expect(project.packages).not.toContain('@longhorn/cache')
    expect(await readFile(join(directory,'README.md'),'utf8')).toBe('# persistent-api\n')
    const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'))
    expect(manifest.longhorn.template).toBe('d1-tasks');expect(manifest.dependencies['@longhorn/runtime']).toBe('file:./.longhorn/framework/runtime')
    expect(manifest.scripts['test:storage']).toContain('tests/storage.mjs')
  })
  it('rejects corrupt D1 assets before publishing or modifying an empty destination',async()=>{
    const assets=await d1Assets(),directory=join(temporary,'empty-d1');await mkdir(directory)
    await writeFile(join(assets.directory,'src/app.ts'),'corrupt copied source')
    await expect(createProject({directory,runtime:'workers',template:'d1-tasks',frameworkDirectory:framework})).rejects.toThrow('assets are unavailable or invalid')
    expect(await readdir(directory)).toEqual([]);expect((await readdir(temporary)).some(name=>name.startsWith('.longhorn-create-'))).toBe(false)
  })
  it('rejects malformed dependency metadata before publishing an unusable project',async()=>{
    const assets=await d1Assets(),directory=join(temporary,'bad-metadata')
    await writeFile(join(assets.directory,'template.json'),JSON.stringify({...assets.descriptor,devDependencies:'invalid'}))
    await expect(createProject({directory,runtime:'workers',template:'d1-tasks',frameworkDirectory:framework})).rejects.toThrow('assets are unavailable or invalid')
    expect(await readdir(temporary)).toEqual(['distribution'])
  })
  it('rejects escaping template paths and incompatible profiles before filesystem output',async()=>{
    const assets=await d1Assets(),directory=join(temporary,'refused')
    assets.descriptor.files['../outside']='a'.repeat(64);await writeFile(join(assets.directory,'template.json'),JSON.stringify(assets.descriptor))
    await expect(createProject({directory,runtime:'workers',template:'d1-tasks',frameworkDirectory:framework})).rejects.toThrow('assets are unavailable or invalid')
    await expect(createProject({directory,runtime:'node',template:'d1-tasks',frameworkDirectory:framework})).rejects.toThrow('requires --runtime workers')
    await expect(createProject({directory,runtime:'workers',template:'other' as 'api',frameworkDirectory:framework})).rejects.toThrow('Unknown template')
    expect(await readdir(temporary)).toEqual(['distribution'])
  })
  it.each(runtimes)('generates an independent %s snapshot and its transitive dependencies', async (runtime) => {
    const directory = join(temporary, 'My Project')
    const project = await createProject({ directory, runtime, frameworkDirectory: framework })
    expect(project.name).toBe('my-project')
    expect(project.packages).toContain('@longhorn/http')
    expect(project.packages).toContain('@longhorn/events')
    expect(project.packages).toContain('@longhorn/cache')
    expect(project.packages).toContain('@longhorn/observability')
    expect(project.packages.includes('@longhorn/database')).toBe(runtime !== 'workers')
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    expect(manifest.longhorn).toEqual({ schemaVersion: 1, runtime, framework: 'snapshot' })
    expect(manifest.packageManager).toBe('pnpm@12.6.0')
    for (const spec of Object.values(manifest.dependencies)) {
      expect(String(spec)).not.toContain('workspace:')
      expect(String(spec)).not.toContain(temporary)
    }
    const runtimeFile = join(directory, '.longhorn/framework', runtime, 'dist/index.js')
    const previous = await readFile(runtimeFile, 'utf8')
    await writeFile(join(framework, runtime, 'dist/index.js'), 'changed distribution')
    expect(await readFile(runtimeFile, 'utf8')).toBe(previous)
    expect(await readFile(join(directory, 'docs/features.md'), 'utf8')).toContain('dependency-injection.md')
  })

  it('accepts an existing empty directory and an explicit name', async () => {
    const directory = join(temporary, 'empty')
    await mkdir(directory)
    expect((await createProject({ directory, name: 'custom-name', runtime: 'node', frameworkDirectory: framework })).name).toBe('custom-name')
    expect(await readdir(directory)).toContain('package.json')
  })

  it('preserves existing files, including hidden files', async () => {
    const directory = join(temporary, 'occupied')
    await mkdir(directory)
    await writeFile(join(directory, '.keep'), 'precious')
    await expect(createProject({ directory, runtime: 'node', frameworkDirectory: framework })).rejects.toThrow('must be empty')
    expect(await readdir(directory)).toEqual(['.keep'])
    expect(await readFile(join(directory, '.keep'), 'utf8')).toBe('precious')
  })

  it('refuses symbolic-link destinations and plain files', async () => {
    const target = join(temporary, 'target')
    const link = join(temporary, 'link')
    await mkdir(target)
    await symlink(target, link, 'dir')
    await expect(createProject({ directory: link, runtime: 'bun', frameworkDirectory: framework })).rejects.toThrow('symbolic link')
    expect(await readdir(target)).toEqual([])
    const file = join(temporary, 'file')
    await writeFile(file, 'keep')
    await expect(createProject({ directory: file, runtime: 'bun', frameworkDirectory: framework })).rejects.toThrow('not a file')
    expect(await readFile(file, 'utf8')).toBe('keep')
  })

  it('removes staging output after a failed snapshot copy without publishing a partial app', async () => {
    const directory = join(temporary, 'failed')
    await rm(join(framework, 'node'), { recursive: true })
    await expect(createProject({ directory, runtime: 'node', frameworkDirectory: framework })).rejects.toThrow()
    expect(await readdir(temporary)).toEqual(['distribution'])
  })

  it('validates names, destinations, runtime, and distribution before writing', async () => {
    const directory = join(temporary, 'invalid')
    for (const name of ['Invalid Name', '../escape', 'node-modules', 'a'.repeat(65)]) {
      await expect(createProject({ directory, runtime: 'node', name, frameworkDirectory: framework })).rejects.toThrow('Project name')
    }
    await expect(createProject({ directory: ' ', runtime: 'node' })).rejects.toThrow('destination')
    await expect(createProject({ directory, runtime: 'other' as 'node' })).rejects.toThrow('Unknown runtime')
    await expect(createProject({ directory, runtime: 'node', frameworkDirectory: join(temporary, 'absent') })).rejects.toThrow('snapshot is unavailable')
    expect(await readdir(temporary)).toEqual(['distribution'])
  })
})
