import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { cp, lstat, mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'
import { chromium,expect } from '@playwright/test'
import { startPostgresCluster } from './postgres-cluster.mjs'
import { openPostgres } from '../runtimes/node/dist/postgres.js'

const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'longhorn-command-app-')),instances=new Set(),secrets=[]
let cluster,admin,browser
function launch(binary,args,cwd,environment={}){
  const env={...process.env,...environment};for(const [name,value]of Object.entries(env))if(value===undefined)delete env[name]
  const child=spawn(binary,args,{cwd,env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});let output='';const records=[]
  createInterface({input:child.stdout}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}});child.stderr.on('data',chunk=>{output+=chunk})
  child.on('error',error=>{output+=error.message})
  const instance={child,records,output:()=>output,ended:new Promise(resolve=>child.once('close',(code,signal)=>{instances.delete(instance);resolve({code,signal})}))};instances.add(instance);return instance
}
function signal(instance,value){if(instance.child.exitCode!==null||instance.child.signalCode!==null)return;try{if(process.platform==='win32')instance.child.kill(value);else process.kill(-instance.child.pid,value)}catch(error){if(error.code!=='ESRCH')throw error}}
async function stop(instance){signal(instance,'SIGTERM');const timer=setTimeout(()=>signal(instance,'SIGKILL'),6000);try{return await instance.ended}finally{clearTimeout(timer)}}
function safe(output){for(const secret of secrets)output=output.replaceAll(secret,'[redacted]');return output}
async function run(binary,args,cwd=temporary,env={}){const instance=launch(binary,args,cwd,env),timer=setTimeout(()=>signal(instance,'SIGKILL'),120000);try{const result=await instance.ended;assert.equal(result.code,0,safe(instance.output()));return instance.output()}finally{clearTimeout(timer)}}
async function waitFor(action){const end=Date.now()+20000;while(Date.now()<end){const value=await action();if(value)return value;await new Promise(resolve=>setTimeout(resolve,40))}throw new Error('Command application gate timed out')}
async function listening(instance){return waitFor(()=>{const record=instance.records.find(row=>row.message==='HTTP server listening');if(record)return record.fields.url;if(instance.child.exitCode!==null||instance.child.signalCode!==null)throw new Error(safe(instance.output()));return false})}
async function freePort(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port}
async function scan(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const file=join(directory,entry.name);if(entry.isDirectory())await scan(file);else{const value=await readFile(file,'utf8');assert.ok(!value.includes(root),'Distribution contains workspace path');assert.ok(!value.includes('workspace:*'),'Distribution contains workspace dependency')}}}

try{
  await run(process.execPath,[join(root,'scripts/package-command-app.mjs')],root)
  const archive=join(root,'.artifacts/longhorn-command-app.tgz'),checksum=(await readFile(archive+'.sha256','utf8')).split(' ')[0];assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'),checksum)
  await run('tar',['-xzf',join(root,'.artifacts/longhorn-command-app.tgz'),'-C',temporary])
  const directory=join(temporary,'relocated command application');await rename(join(temporary,'longhorn-command-app'),directory)
  await scan(directory)
  const locked=await readFile(join(directory,'pnpm-lock.yaml'),'utf8'),distribution=JSON.parse(await readFile(join(directory,'.longhorn/distribution.json'),'utf8'))
  assert.deepEqual(distribution.dependencyLock,{file:'pnpm-lock.yaml',sha256:createHash('sha256').update(locked).digest('hex'),packageManager:'pnpm@12.6.0'})
  await run('pnpm',['install','--frozen-lockfile','--reporter=append-only'],directory,{CI:'true'})
  assert.equal(await readFile(join(directory,'pnpm-lock.yaml'),'utf8'),locked,'Frozen installation changed the shipped lockfile')
  const manifestFile=join(directory,'package.json'),manifestText=await readFile(manifestFile,'utf8'),changedManifest=JSON.parse(manifestText)
  changedManifest.dependencies.hono='0.0.0-drift-check'
  await writeFile(manifestFile,JSON.stringify(changedManifest,null,2)+'\n')
  try{
    const drift=launch('pnpm',['install','--frozen-lockfile','--offline','--reporter=append-only'],directory,{CI:'true'});assert.equal((await drift.ended).code,1);assert.ok(drift.output().includes('OUTDATED_LOCKFILE'),safe(drift.output()))
    assert.equal(await readFile(join(directory,'pnpm-lock.yaml'),'utf8'),locked,'Rejected manifest drift rewrote the lockfile')
  }finally{await writeFile(manifestFile,manifestText)}
  for(const action of ['typecheck','test','build'])await run('pnpm',[action],directory)
  console.log('Command distribution: actual archive relocated, frozen-installed in CI mode with unchanged locked dependencies, manifest drift rejected, typechecked, tested and built without workspace paths or unpublished registry dependencies.')

  cluster=await startPostgresCluster();admin=await openPostgres({connectionString:cluster.connectionString})
  const ownerPassword=randomBytes(24).toString('hex'),appPassword=randomBytes(24).toString('hex');secrets.push(ownerPassword,appPassword)
  for(const [role,password]of[['starter_owner',ownerPassword],['starter_app',appPassword]])await admin.execute('CREATE ROLE '+role+" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '"+password+"'")
  await admin.execute('CREATE DATABASE starter_app OWNER starter_owner');await admin.execute('REVOKE ALL ON DATABASE starter_app FROM PUBLIC');await admin.execute('GRANT CONNECT ON DATABASE starter_app TO starter_owner,starter_app')
  const address=(role,password)=>{const url=new URL(cluster.connectionString);url.username=role;url.password=password;url.pathname='/starter_app';return url.href},ownerUrl=address('starter_owner',ownerPassword),appUrl=address('starter_app',appPassword)
  secrets.push(ownerUrl,appUrl)
  const owner=await openPostgres({connectionString:ownerUrl});try{await owner.execute('REVOKE ALL ON SCHEMA public FROM PUBLIC')}finally{await owner.close()}
  const deploy={MIGRATION_DATABASE_URL:ownerUrl}
  await run('pnpm',['migrate'],directory,deploy);await run('pnpm',['migrate'],directory,deploy)
  await run('pnpm',['provision:runtime','starter_app'],directory,deploy)
  for(const role of ['starter_app;DROP','longhorn_admin']){const invalid=launch('pnpm',['provision:runtime',role],directory,deploy);assert.equal((await invalid.ended).code,1)}
  const serviceToken=randomBytes(32).toString('hex');secrets.push(serviceToken)
  const receiverPort=await freePort(),hostPort=await freePort(),origin='http://127.0.0.1:'+hostPort,receiverPath=join(temporary,'retained-receiver')
  const receiverEnv={HOST:'127.0.0.1',PORT:String(receiverPort),RECEIVER_TOKEN:serviceToken,RECEIVER_DATA_PATH:receiverPath,MIGRATION_DATABASE_URL:undefined}
  const hostEnv={DATABASE_URL:appUrl,HOST:'127.0.0.1',PORT:String(hostPort),AUTH_ORIGIN:origin,AUTH_COOKIE_SECURE:'false',MESSAGE_SERVICE_URL:'http://127.0.0.1:'+receiverPort+'/',MESSAGE_SERVICE_TOKEN:serviceToken,MESSAGE_ALLOW_INSECURE_LOOPBACK:'true',MIGRATION_DATABASE_URL:undefined}
  // Exercise the shipped private profile loader, not only process environment.
  await writeFile(join(directory,'.operator.env'),Object.entries(hostEnv).filter(([,value])=>value!==undefined).map(([key,value])=>key+'='+value).join('\n')+'\n',{mode:0o600})
  const startReceiver=async()=>{const instance=launch(process.execPath,['scripts/serve-receiver.mjs'],directory,receiverEnv);await listening(instance);return instance}
  const startHost=async()=>{const instance=launch(process.execPath,['dist/operator-host.js'],directory,{MIGRATION_DATABASE_URL:undefined});assert.equal(await listening(instance),origin);return instance}
  for(const [grant,revoke]of [
    ['ALTER ROLE starter_app BYPASSRLS','ALTER ROLE starter_app NOBYPASSRLS'],
    ['GRANT CREATE ON DATABASE starter_app TO starter_app','REVOKE CREATE ON DATABASE starter_app FROM starter_app'],
    ['GRANT starter_owner TO starter_app WITH INHERIT FALSE, SET TRUE','REVOKE starter_owner FROM starter_app'],
  ]){
    await admin.execute(grant)
    try{const rejected=launch(process.execPath,['dist/operator-host.js'],directory,{MIGRATION_DATABASE_URL:undefined});assert.equal((await rejected.ended).code,1);assert.ok(!rejected.records.some(row=>row.message==='HTTP server listening'))}finally{await admin.execute(revoke)}
  }
  let receiver=await startReceiver(),host=await startHost()
  const password='a long native starter passphrase',post=(input,cookie)=>({method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(input)})
  const nextPassword='a changed native starter passphrase';secrets.push(password,nextPassword)
  for(const username of ['starter.member','starter.operator'])assert.equal((await fetch(origin+'/account/register',post({username,password}))).status,201)
  await run('pnpm',['operator','grant','starter.operator'],directory,deploy)
  const login=async username=>{const response=await fetch(origin+'/account/login',post({username,password}));assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];secrets.push(cookie.split('=')[1]);return cookie}
  const member=await login('starter.member'),operator=await login('starter.operator'),headers={Cookie:member}
  const input={id:'starter-first',numbers:[4,8,15]},response=await fetch(origin+'/account/commands',post(input,member));assert.equal(response.status,201);const first=await response.json()
  const replay=await fetch(origin+'/account/commands',post(input,member));assert.equal(replay.headers.get('idempotency-replayed'),'true');assert.deepEqual(await replay.json(),first)
  const receipt=async(id,cookie)=>{const response=await fetch(origin+'/account/commands/'+id+'/receipt',{headers:{Cookie:cookie}});return response.status===200?await response.json():false}
  await waitFor(async()=>{const value=await receipt(first.command.id,member);return value&&value.receipts[0].result.sum===27})
  assert.equal((await fetch(origin+'/account/operations/deliveries',{headers})).status,403)
  assert.equal((await fetch(origin+'/account/commands?scope=all',{headers})).status,403)
  assert.equal((await fetch(origin+'/account/commands',post({id:'spoof',numbers:[1],owner:'spoof'},member))).status,400)
  assert.equal((await fetch(origin+'/account/commands',{...post({id:'cross-origin',numbers:[1]},member),headers:{...post({},member).headers,Origin:'https://untrusted.example'}})).status,403)
  browser=await chromium.launch();const page=await browser.newPage();await page.goto(origin+'/console');await page.getByRole('link',{name:'Sign in',exact:true}).click();await page.getByLabel('Username',{exact:true}).fill('starter.member');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'Your commands'}).waitFor();await page.getByRole('link',{name:'Command '+first.command.id.slice(0,8),exact:true}).waitFor();await browser.close();browser=undefined

  assert.equal((await stop(receiver)).code,0)
  const failedResponse=await fetch(origin+'/account/commands',post({id:'starter-outage',numbers:[18,22]},member));assert.equal(failedResponse.status,201);const failed=await failedResponse.json()
  const delivery=async()=>{const response=await fetch(origin+'/account/operations/deliveries/'+failed.delivery.id,{headers:{Cookie:operator}});assert.equal(response.status,200);return(await response.json()).delivery}
  await waitFor(async()=>(await delivery()).state==='failed');const observed=await delivery()
  receiver=await startReceiver()
  browser=await chromium.launch();const followPage=await browser.newPage();await followPage.goto(origin+'/console#/login');await followPage.getByLabel('Username',{exact:true}).fill('starter.member');await followPage.getByLabel('Password',{exact:true}).fill(password);await followPage.getByRole('button',{name:'Sign in',exact:true}).click();await expect(followPage.getByRole('heading',{name:'Your commands',exact:true})).toBeVisible()
  await followPage.getByRole('link',{name:'Command '+failed.command.id.slice(0,8),exact:true}).click();await expect(followPage.getByRole('button',{name:'Follow updates',exact:true})).toBeVisible();await followPage.getByRole('button',{name:'Follow updates',exact:true}).click()
  const recovered=await fetch(origin+'/account/operations/deliveries/'+failed.delivery.id+'/retry',post({expectedMaxAttempts:observed.maxAttempts,additionalAttempts:1,reason:'provider-restored'},operator));assert.equal(recovered.status,202)
  await waitFor(async()=>{const value=await receipt(failed.command.id,member);return value&&value.receipts[0].result.sum===40})
  await expect(followPage.locator('.receipt-values')).toContainText('40',{timeout:15000});await expect(followPage.locator('.follow-updates [role=status]')).toHaveText('Receipt received. Updates stopped.');await browser.close();browser=undefined
  assert.equal((await stop(host)).code,0);assert.equal((await stop(receiver)).code,0)
  receiver=await startReceiver();host=await startHost()
  const history=await(await fetch(origin+'/account/commands',{headers})).json();assert.equal(history.commands.length,2)
  assert.equal((await receipt(first.command.id,member)).receipts[0].result.sum,27)
  const audit=await(await fetch(origin+'/account/operations/audit',{headers:{Cookie:operator}})).json();assert.equal(audit.records.length,1);assert.equal(audit.records[0].reason,'provider-restored')
  for(const instance of [host,receiver]){for(const secret of secrets)assert.ok(!instance.output().includes(secret),'Host logged a credential');assert.equal((await stop(instance)).code,0)}
  console.log('Command distribution: shipped schema/grants and separate credential shells, actual browser assets, native sessions, scoped replay/history, protected receipts, denial checks, outage/retry/audit, shipped automatic receipt updates without manual refresh and both-process persistence verified.')

  const clients=process.env.LONGHORN_PG_CLIENT_BIN??JSON.parse(await readFile(join(root,'.artifacts/postgres-clients.json'),'utf8')).directory
  const backup=join(temporary,'checkpoint'),backupEnvironment={...deploy,RECEIVER_DATA_PATH:receiverPath,LONGHORN_PG_CLIENT_BIN:clients}
  for(const args of [['state:backup',backup],['state:backup',join(receiverPath,'nested-backup'),'--offline']]){const rejected=launch('pnpm',args,directory,backupEnvironment);assert.equal((await rejected.ended).code,1)}
  await run('pnpm',['state:backup',backup,'--offline'],directory,backupEnvironment)
  assert.equal(JSON.parse(await readFile(join(backup,'manifest.json'),'utf8')).postgresMajor,18)
  const occupiedTarget=join(temporary,'must-stay-absent'),occupied=launch('pnpm',['state:restore',backup,'--offline'],directory,{...backupEnvironment,RECEIVER_DATA_PATH:occupiedTarget});assert.equal((await occupied.ended).code,1);await assert.rejects(lstat(occupiedTarget),{code:'ENOENT'})
  await admin.execute('CREATE DATABASE starter_restored OWNER starter_owner');await admin.execute('REVOKE ALL ON DATABASE starter_restored FROM PUBLIC');await admin.execute('GRANT CONNECT ON DATABASE starter_restored TO starter_owner,starter_app')
  const restoredOwnerUrl=new URL(ownerUrl);restoredOwnerUrl.pathname='/starter_restored';const restoredAppUrl=new URL(appUrl);restoredAppUrl.pathname='/starter_restored'
  secrets.push(restoredOwnerUrl.href,restoredAppUrl.href)
  const restoredReceiver=join(temporary,'restored-receiver'),restoreEnvironment={MIGRATION_DATABASE_URL:restoredOwnerUrl.href,RECEIVER_DATA_PATH:restoredReceiver,LONGHORN_PG_CLIENT_BIN:clients}
  const corrupt=join(temporary,'corrupt-checkpoint');await cp(backup,corrupt,{recursive:true});await writeFile(join(corrupt,'database.dump'),'corrupted')
  const invalid=launch('pnpm',['state:restore',corrupt,'--offline'],directory,restoreEnvironment);assert.equal((await invalid.ended).code,1)
  await cp(backup,corrupt,{recursive:true,force:true});const metadata=JSON.parse(await readFile(join(corrupt,'manifest.json'),'utf8'));assert.ok(metadata.receiver.length);await writeFile(join(corrupt,'receiver',metadata.receiver[0].path),'corrupted receipt storage')
  const invalidReceipt=launch('pnpm',['state:restore',corrupt,'--offline'],directory,restoreEnvironment);assert.equal((await invalidReceipt.ended).code,1);await assert.rejects(lstat(restoredReceiver),{code:'ENOENT'})
  await run('pnpm',['state:restore',backup,'--offline'],directory,restoreEnvironment)
  const restoredOwner=await openPostgres({connectionString:restoredOwnerUrl.href})
  try{
    const publicExecution=await restoredOwner.execute("SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='longhorn_auth' AND a.grantee=0 AND a.privilege_type='EXECUTE'")
    assert.equal(publicExecution.rows.length,0)
  }finally{await restoredOwner.close()}
  await run('pnpm',['migrate'],directory,restoreEnvironment);await run('pnpm',['provision:runtime','starter_app'],directory,restoreEnvironment)
  await writeFile(join(directory,'.operator.env'),Object.entries({...hostEnv,DATABASE_URL:restoredAppUrl.href}).filter(([,value])=>value!==undefined).map(([key,value])=>key+'='+value).join('\n')+'\n',{mode:0o600})
  receiverEnv.RECEIVER_DATA_PATH=restoredReceiver;receiver=await startReceiver();host=await startHost()
  const restoredHistory=await(await fetch(origin+'/account/commands',{headers})).json();assert.equal(restoredHistory.commands.length,2)
  assert.equal((await receipt(first.command.id,member)).receipts[0].result.sum,27)
  assert.equal((await receipt(failed.command.id,member)).receipts[0].result.sum,40)
  const retainedReplay=await fetch(origin+'/account/commands',post(input,member));assert.equal(retainedReplay.headers.get('idempotency-replayed'),'true');assert.deepEqual(await retainedReplay.json(),first)
  const retainedAudit=await(await fetch(origin+'/account/operations/audit',{headers:{Cookie:operator}})).json();assert.equal(retainedAudit.records[0].reason,'provider-restored')
  const next=await fetch(origin+'/account/commands',post({id:'after-restore',numbers:[7,9]},member));assert.equal(next.status,201);const newCommand=await next.json();await waitFor(async()=>{const value=await receipt(newCommand.command.id,member);return value&&value.receipts[0].result.sum===16})
  const runtime=await openPostgres({connectionString:restoredAppUrl.href})
  try{await assert.rejects(runtime.execute("UPDATE longhorn_auth.users SET roles='[]'::jsonb"));await assert.rejects(runtime.execute("UPDATE longhorn_auth.users SET password_hash='forged'"));await assert.rejects(runtime.execute("UPDATE longhorn_outbox.recovery_audit SET reason='manual-retry'"));await assert.rejects(runtime.execute('SELECT * FROM longhorn_pg_example.longhorn_migrations'))}finally{await runtime.close()}
  console.log('Offline restore: checksum rejection, complete schema/history/identity, sessions/roles, replay, receipts and audit restored into a new database/storage path; PUBLIC auth execution revoked, minimal grants reapplied and a new computed command verified.')
  const extra=await login('starter.member')
  browser=await chromium.launch();const accountPage=await browser.newPage()
  await accountPage.goto(origin+'/console#/login');await accountPage.getByLabel('Username',{exact:true}).fill('starter.member');await accountPage.getByLabel('Password',{exact:true}).fill(password);await accountPage.getByRole('button',{name:'Sign in',exact:true}).click();await accountPage.getByRole('heading',{name:'Your commands',exact:true}).waitFor()
  await accountPage.getByRole('link',{name:'Account',exact:true}).click();await accountPage.getByLabel('Current password',{exact:true}).fill(password);await accountPage.getByLabel('New password',{exact:true}).fill(nextPassword);await accountPage.getByLabel('Confirm new password',{exact:true}).fill(nextPassword)
  const passwordResponse=accountPage.waitForResponse(value=>value.url()===origin+'/account/password'&&value.request().method()==='POST')
  await accountPage.getByRole('button',{name:'Change password',exact:true}).click();const changed=await passwordResponse
  assert.equal(changed.status(),204);assert.ok((await changed.headerValue('set-cookie'))?.includes('Max-Age=0'))
  await expect(accountPage.getByRole('status')).toContainText('Password changed.');await expect(accountPage.getByRole('heading',{name:'Sign in to LongHorn'})).toBeVisible();assert.ok(!(await accountPage.context().cookies()).some(cookie=>cookie.name==='longhorn_dev'))
  await browser.close();browser=undefined
  for(const cookie of[member,extra])assert.equal((await fetch(origin+'/account/session',{headers:{Cookie:cookie}})).status,401)
  assert.equal((await fetch(origin+'/account/session',{headers:{Cookie:operator}})).status,200)
  assert.equal((await fetch(origin+'/account/login',post({username:'starter.member',password}))).status,401)
  const logged=await fetch(origin+'/account/login',post({username:'starter.member',password:nextPassword}));assert.equal(logged.status,200)
  const fresh=logged.headers.get('set-cookie').split(';')[0];secrets.push(fresh.split('=')[1]);await logged.json()
  assert.equal((await(await fetch(origin+'/account/commands',{headers:{Cookie:fresh}})).json()).commands.length,3)
  assert.equal((await stop(host)).code,0);host=await startHost()
  assert.equal((await fetch(origin+'/account/session',{headers:{Cookie:fresh}})).status,200)
  browser=await chromium.launch();const sessionPage=await browser.newPage()
  await sessionPage.goto(origin+'/console#/login');await sessionPage.getByLabel('Username',{exact:true}).fill('starter.member');await sessionPage.getByLabel('Password',{exact:true}).fill(nextPassword);await sessionPage.getByRole('button',{name:'Sign in',exact:true}).click();await sessionPage.getByRole('heading',{name:'Your commands',exact:true}).waitFor()
  await sessionPage.getByRole('link',{name:'Command '+first.command.id.slice(0,8),exact:true}).click();await sessionPage.getByRole('link',{name:'Run again',exact:true}).click();await expect(sessionPage.getByRole('heading',{name:'Run command again',exact:true})).toBeVisible();await expect(sessionPage.getByLabel('Numbers',{exact:true})).toHaveValue('4, 8, 15')
  await sessionPage.reload();await expect(sessionPage.getByLabel('Numbers',{exact:true})).toHaveValue('4, 8, 15')
  const rerunResponse=sessionPage.waitForResponse(value=>value.url()===origin+'/account/commands'&&value.request().method()==='POST')
  await sessionPage.getByRole('button',{name:'Create command',exact:true}).click();const rerunAccepted=await rerunResponse;assert.equal(rerunAccepted.status(),201);const rerunSaved=await rerunAccepted.json();assert.notEqual(rerunSaved.command.id,first.command.id);assert.notEqual(rerunSaved.delivery.id,first.delivery.id)
  await expect(sessionPage.getByRole('heading',{name:'Command '+rerunSaved.command.id.slice(0,8),exact:true})).toBeVisible();await waitFor(async()=>{const value=await receipt(rerunSaved.command.id,fresh);return value&&value.receipts[0].result.sum===27});assert.equal((await receipt(first.command.id,fresh)).receipts[0].result.sum,27);await expect(sessionPage.locator('.receipt-values')).toContainText('27',{timeout:15000})
  await sessionPage.getByRole('link',{name:'Commands',exact:true}).click();await expect(sessionPage.getByRole('heading',{name:'Your commands',exact:true})).toBeVisible();await sessionPage.getByLabel('Delivery status',{exact:true}).selectOption('succeeded');await expect(sessionPage.locator('ul.rows>li')).toHaveCount(4)
  await sessionPage.getByLabel('Delivery status',{exact:true}).selectOption('failed');await expect(sessionPage.getByRole('heading',{name:'No matching commands',exact:true})).toBeVisible();await sessionPage.getByRole('button',{name:'Show all',exact:true}).click();await expect(sessionPage.getByLabel('Delivery status',{exact:true})).toHaveValue('all');await expect(sessionPage.locator('ul.rows>li')).toHaveCount(4)
  for(const cookie of await sessionPage.context().cookies())secrets.push(cookie.value)
  await sessionPage.getByRole('link',{name:'Account',exact:true}).click();await sessionPage.getByRole('button',{name:'End other sessions',exact:true}).click();await expect(sessionPage.locator('#notice')).toContainText('Ended 1 other session.')
  assert.equal((await fetch(origin+'/account/session',{headers:{Cookie:fresh}})).status,401);assert.equal((await fetch(origin+'/account/session',{headers:{Cookie:operator}})).status,200)
  await sessionPage.getByRole('link',{name:'Commands',exact:true}).click();await expect(sessionPage.getByRole('heading',{name:'Your commands',exact:true})).toBeVisible();assert.equal(await sessionPage.locator('ul.rows>li').count(),4)
  await sessionPage.getByRole('link',{name:'Account',exact:true}).click();await sessionPage.getByRole('button',{name:'Sign out everywhere',exact:true}).click();await expect(sessionPage.locator('#notice')).toContainText('Signed out everywhere.');await expect(sessionPage.getByRole('heading',{name:'Sign in to LongHorn'})).toBeVisible()
  assert.ok(!(await sessionPage.context().cookies()).some(cookie=>cookie.name==='longhorn_dev'));await browser.close();browser=undefined
  for(const secret of secrets)assert.ok(!host.output().includes(secret),'Restored host logged a credential')
  console.log('Restored password capability: shipped browser Account form and explicit function regrant permit native replacement and all-session revocation without direct password UPDATE; current history/peer session survive a host restart; shipped scoped sign-out controls preserve the current browser and isolate the operator; Run again creates a separate command/receipt from a restored source after deep-link reload; live delivery filters and clear-filter fallback use the restored metadata.')
}finally{
  await browser?.close();await Promise.all([...instances].map(stop));await admin?.close();await cluster?.stop();await rm(temporary,{recursive:true,force:true})
}
