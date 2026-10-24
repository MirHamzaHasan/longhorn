import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createRequire } from 'node:module'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startAccountOperationsSandbox } from './account-operations-sandbox.mjs'
import { openSqlite } from '../runtimes/node/dist/sqlite.js'
import { openPostgres } from '../runtimes/node/dist/postgres.js'
import { SqliteAuthStore } from '../packages/auth/dist/sqlite.js'
import { PostgresAuthStore } from '../packages/auth/dist/postgres.js'
const root=fileURLToPath(new URL('..',import.meta.url)),require=createRequire(import.meta.url),directory=await mkdtemp(join(tmpdir(),'longhorn-session-controls-')),children=new Set()
const binaries={node:process.execPath,bun:join(dirname(require.resolve('bun-runtime/package.json')),'bin/bun.exe'),deno:join(dirname(require.resolve('deno-runtime/package.json')),process.platform==='win32'?'deno.exe':'deno')}
let sandbox
function launch(binary,args,env={}){
  const child=spawn(binary,args,{cwd:root,env:{...process.env,...env},detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']}),records=[];let output=''
  for(const stream of[child.stdout,child.stderr])createInterface({input:stream}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}})
  child.on('error',()=>{output+='Owned session verifier could not start\n'})
  const owned={child,records,output:()=>output.replace(/\b[a-f0-9]{64}\b/g,'[fixture digest]'),ended:new Promise(resolve=>child.once('close',(code,signal)=>{children.delete(owned);resolve({code,signal})}))};children.add(owned);return owned
}
function kill(owned){if(owned.child.exitCode!==null||owned.child.signalCode!==null)return;try{if(process.platform==='win32')owned.child.kill('SIGKILL');else process.kill(-owned.child.pid,'SIGKILL')}catch(error){if(error.code!=='ESRCH')throw error}}
async function completed(owned){const timer=setTimeout(()=>kill(owned),60000);try{assert.deepEqual(await owned.ended,{code:0,signal:null},owned.output())}finally{clearTimeout(timer)}}
async function checkpoint(owned){const end=Date.now()+20000;while(Date.now()<end){if(owned.records.some(value=>value.message==='Session control transaction before commit'))return;if(owned.child.exitCode!==null||owned.child.signalCode!==null)break;await new Promise(resolve=>setTimeout(resolve,10))}throw new Error('Native session checkpoint missing: '+owned.output())}
try{
  sandbox=await startAccountOperationsSandbox()
  await completed(launch('pnpm',['exec','vitest','run','--config','vitest.session-controls.config.ts'],{LONGHORN_PG_TEST_OWNED:'true',LONGHORN_PG_TEST_URL:sandbox.ownerUrl,LONGHORN_PG_APP_URL:sandbox.appUrl}))
  console.log('PostgreSQL: six real restricted-role session-control cases passed, including reciprocal ownership, login/password ordering, row-wait expiry, rollback, grants and isolation.')
  for(const runtime of['node','bun','deno','pg']){
    for(const mode of runtime==='pg'?['crash']:['verify','crash']){
      const filename=join(directory,runtime+'-'+mode+'.sqlite'),entry=join(root,'scripts/fixtures/session-control-native-'+runtime+'.mjs'),params=[mode,filename]
      const args=runtime==='deno'?['run','--no-prompt','--no-lock','--node-modules-dir=manual','--allow-read='+directory,'--allow-write='+directory,entry,...params]:[entry,...params]
      const owned=launch(runtime==='pg'?process.execPath:binaries[runtime],args,runtime==='pg'?{LONGHORN_PG_APP_URL:sandbox.appUrl}:{})
      if(mode==='verify'){await completed(owned);assert.ok(owned.records.some(value=>value.message==='Native session controls verified'));continue}
      await checkpoint(owned);kill(owned);assert.equal((await owned.ended).signal,'SIGKILL')
      const database=runtime==='pg'?await openPostgres({connectionString:sandbox.appUrl}):await openSqlite({filename})
      try{const store=runtime==='pg'?new PostgresAuthStore(database):new SqliteAuthStore(database);for(const hash of['a','b','c','d'])assert.ok(await store.findSession(hash.repeat(64)),'Uncommitted session deletion survived process death')}
      finally{await database.close()}
    }
    console.log(runtime+': actual native session controls and SIGKILL-after-delete/before-commit recovery verified.')
  }
}finally{for(const owned of children)kill(owned);await Promise.all([...children].map(value=>value.ended));await sandbox?.stop();await rm(directory,{recursive:true,force:true})}
