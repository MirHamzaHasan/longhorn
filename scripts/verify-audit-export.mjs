import assert from 'node:assert/strict'
import { chromium,expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createServer } from 'node:net'
import { mkdir,writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { startAccountOperationsSandbox } from './account-operations-sandbox.mjs'
import { openPostgres } from '../runtimes/node/dist/postgres.js'
import { createScryptPasswordHasher } from '../runtimes/node/dist/passwords.js'
import { nodeRuntime } from '../runtimes/node/dist/index.js'
import { PostgresAuthStore } from '../packages/auth/dist/postgres.js'
import { createPostgresApp } from '../examples/postgres/dist/app.js'
import { loadConsoleAssets } from '../examples/postgres/dist/console-assets.js'
import { Outbox } from '../packages/outbox/dist/index.js'
import { PostgresOutboxStore } from '../packages/outbox/dist/postgres.js'
import { operationTopic,operationData } from '../examples/postgres/dist/operation-contracts.js'

const output=resolve(process.env.LONGHORN_AUDIT_EXPORT_QA_DIR??'.artifacts/console/audit-export'),password='owned native audit export password',captures=[],violations=[],errors=[],holds=[]
let sandbox,owner,db,outgoing,app,browser,downloads=0
const waitFor=async predicate=>{const end=Date.now()+20000;while(Date.now()<end){const value=await predicate();if(value)return value;await new Promise(done=>setTimeout(done,20))}throw new Error('History export condition did not settle')}
async function port(){const socket=createServer();await new Promise((done,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',done)});const value=socket.address().port;await new Promise(done=>socket.close(done));return value}
async function go(page,hash){await page.evaluate(value=>{location.hash=value},hash);await expect(page.locator('#main')).toHaveAttribute('data-route',hash);await expect(page.locator('#main')).toHaveAttribute('aria-busy','false')}
async function register(page,url,username){await page.goto(url+'#/register');await page.getByLabel('Username',{exact:true}).fill(username);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Create account',exact:true}).click();await expect(page.getByRole('heading',{name:'Your commands',exact:true})).toBeVisible()}
async function capture(page,name){
  for(const theme of['light','dark']){
    if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:theme==='dark'?'Use dark theme':'Use light theme'}).click()
    for(const[width,height,label]of[[1360,960,'desktop'],[390,844,'phone']]){
      await page.setViewportSize({width,height});await page.evaluate(()=>scrollTo(0,0));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
      const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();violations.push(...scan.violations.map(v=>({name,theme,width,id:v.id})))
      const filename=resolve(output,name+'-'+theme+'-'+label+'.png');await page.mouse.move(0,0);await page.screenshot({path:filename});captures.push(filename)
    }
  }
  await page.setViewportSize({width:1360,height:960});console.log('Audit export QA captured: '+name)
}
async function exported(page){
  const pending=page.waitForEvent('download',{timeout:30000});await page.getByRole('button',{name:'Export audit',exact:true}).click();const download=await pending
  assert.match(download.suggestedFilename(),/^longhorn-audit-(?:all|[0-9a-f-]{36})-[0-9TZ-]+\.ndjson$/)
  const stream=await download.createReadStream(),parts=[];for await(const part of stream)parts.push(part);const bytes=Buffer.concat(parts);assert.ok(bytes.length<=8*1024*1024)
  const text=bytes.toString('utf8'),lines=text.trim().split('\n').map(line=>JSON.parse(line));assert.equal(lines[0].type,'longhorn-recovery-audit');assert.equal(lines[0].version,1);assert.equal(lines.at(-1).type,'end');assert.equal(lines.length-2,lines.at(-1).count)
  assert.ok(!/"(?:numbers|payload|lease_token|password|tokenHash|ownerId)"\s*:/.test(text));assert.ok(lines.slice(1,-1).every(line=>line.type==='audit'))
  await download.delete();return{header:lines[0],end:lines.at(-1),records:lines.slice(1,-1).map(line=>line.record),bytes:bytes.length}
}
async function hold(page,{limit='100',after=false}={}){
  let release;const gate=new Promise(done=>{release=done}),held={entered:false,done:false,error:undefined,aborted:false,release}
  const matcher=url=>url.pathname==='/account/operations/audit'&&url.searchParams.get('limit')===limit&&url.searchParams.has('after')===after
  page.on('requestfailed',request=>{if(matcher(new URL(request.url()))&&request.failure()?.errorText==='net::ERR_ABORTED')held.aborted=true})
  await page.route(matcher,async route=>{try{const response=await route.fetch();assert.equal(response.status(),200);held.entered=true;await gate;try{await route.fulfill({response})}catch(error){if(!held.aborted)throw error}}catch(error){held.error=error}finally{held.done=true}},{times:1})
  held.finish=async(canceled=true)=>{release();await waitFor(()=>held.done);await page.unroute(matcher);if(held.error)throw held.error;if(canceled)assert.ok(held.aborted)};holds.push(held);return held
}
try{
  await mkdir(output,{recursive:true});sandbox=await startAccountOperationsSandbox();owner=await openPostgres({connectionString:sandbox.ownerUrl});db=await openPostgres({connectionString:sandbox.appUrl});const selected=await port(),origin='http://127.0.0.1:'+selected
  app=createPostgresApp({console:await loadConsoleAssets(),openDatabase:()=>openPostgres({connectionString:sandbox.appUrl}),workerEnabled:false,schedulerEnabled:false,accounts:{origin,secure:false,sessionTtlMs:28800000,passwords:createScryptPasswordHasher(),sessionControls:true},operations:{}});await app.listen(nodeRuntime,{hostname:'127.0.0.1',port:selected})
  outgoing=new Outbox({name:operationTopic,schema:operationData,store:new PostgresOutboxStore(db),leaseMs:60000,retryDelayMs:0})
  browser=await chromium.launch();const context=await browser.newContext({acceptDownloads:true,viewport:{width:1360,height:960},reducedMotion:'reduce'}),memberContext=await browser.newContext(),page=await context.newPage(),member=await memberContext.newPage(),requests=[]
  await page.addInitScript(()=>{const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);window.__auditUrls=new Set();URL.createObjectURL=value=>{const url=create(value);window.__auditUrls.add(url);return url};URL.revokeObjectURL=url=>{window.__auditUrls.delete(url);return revoke(url)}})
  for(const p of[page,member]){p.on('pageerror',error=>errors.push(error.message));p.on('download',()=>++downloads)}
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/account/operations/audit'&&url.searchParams.get('limit')==='100')requests.push({url:url.href,viewer:request.headers()['x-longhorn-viewer']})})
  await register(page,origin+'/console','audit.operator');await register(member,origin+'/console','audit.member')
  const store=new PostgresAuthStore(owner);await store.setUserRole('audit.operator','numbers-operator',true)
  const login=async()=>{await go(page,'#/login');await page.getByLabel('Username',{exact:true}).fill('audit.operator');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByLabel('Show commands',{exact:true})).toBeVisible()}
  await login();const actor=(await(await page.request.get(origin+'/account/session')).json()).user.id
  const cookie=async c=>'longhorn_dev='+(await c.cookies()).find(value=>value.name==='longhorn_dev').value
  let operatorCookie=await cookie(context);const memberCookie=await cookie(memberContext)
  const request=(path,body,cookieValue=operatorCookie)=>fetch(origin+'/account'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookieValue,...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})
  assert.equal((await fetch(origin+'/account/operations/audit?limit=100')).status,401);assert.equal((await request('/operations/audit?limit=100',undefined,memberCookie)).status,403)
  await go(member,'#/audit');await expect(member.getByRole('heading',{name:'Operator access required',exact:true})).toBeVisible();await expect(member.getByRole('button',{name:'Export audit',exact:true})).toHaveCount(0);await capture(member,'member-denied')
  await go(page,'#/audit');const empty=await exported(page);assert.equal(empty.end.count,0);assert.equal(empty.end.complete,true);await capture(page,'empty-audit')
  const create=async key=>{const response=await request('/commands',{id:key,numbers:[7,11]},memberCookie);assert.equal(response.status,201);return response.json()}
  const first=await create('audit-first'),second=await create('audit-second')
  for(let i=0;i<8;i++)await outgoing.dispatchOnce({async publish(){throw new Error('Owned audit fixture publisher failure')}})
  const retry=async(deliveryId,expectedMaxAttempts,additionalAttempts,status)=>{const response=await request('/operations/deliveries/'+deliveryId+'/retry',{expectedMaxAttempts,additionalAttempts,reason:'provider-restored'});assert.equal(response.status,status);return(await response.json()).audit}
  const records=[];records.push(await retry(first.delivery.id,3,1,202));records.push(await retry(first.delivery.id,3,1,409));records.push(await retry(second.delivery.id,3,100,409));const missing=crypto.randomUUID();records.push(await retry(missing,3,1,404))
  for(let i=0;i<101;i++)records.push(await retry(first.delivery.id,3,1,409))
  assert.deepEqual(new Set(records.map(row=>row.outcome)),new Set(['scheduled','conflict','budget-exhausted','missing']));assert.ok(records.every(row=>row.actor==='user:'+actor))
  assert.equal(await new PostgresOutboxStore(owner).prune('outbox.command.numbers.v1',{before:Date.now(),limit:100,includeFailed:true}),1)
  assert.equal((await request('/operations/deliveries/'+second.delivery.id)).status,404)
  await go(page,'#/commands');await go(page,'#/audit');const all=await exported(page);assert.equal(all.end.count,105);assert.equal(all.end.complete,true);assert.deepEqual(all.records,records.slice().sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id)));assert.equal(all.header.selection.deliveryId,null);assert.ok(requests.some(row=>new URL(row.url).searchParams.has('after')));await capture(page,'all-audit-ready')
  await go(page,'#/audit/'+first.delivery.id);const scoped=await exported(page);assert.equal(scoped.end.count,103);assert.equal(scoped.header.selection.deliveryId,first.delivery.id);assert.ok(scoped.records.every(row=>row.deliveryId===first.delivery.id));await capture(page,'delivery-audit-ready')
  await go(page,'#/audit/'+second.delivery.id);const pruned=await exported(page);assert.equal(pruned.end.count,1);assert.equal(pruned.records[0].outcome,'budget-exhausted');await capture(page,'pruned-delivery-audit')
  await go(page,'#/audit/'+missing);assert.equal((await exported(page)).records[0].result,null)
  await go(page,'#/audit');await expect.poll(()=>page.evaluate(()=>window.__auditUrls.size)).toBe(0)
  const listing=await hold(page,{limit:'20',after:true});await page.getByRole('button',{name:'Load more actions',exact:true}).click();await waitFor(()=>listing.entered);await go(page,'#/commands');await listing.finish();await expect(page.locator('#notice')).toBeHidden();await go(page,'#/audit')
  const beforeFailed=downloads,canceled=await hold(page);await page.getByRole('button',{name:'Export audit',exact:true}).click();await waitFor(()=>canceled.entered);await capture(page,'audit-preparing');const cancel=page.getByRole('button',{name:'Cancel export',exact:true});await cancel.focus();await page.keyboard.press('Enter');await canceled.finish();await expect(cancel).toBeFocused();await expect(page.locator('.history-export [role=status]')).toContainText('No file was downloaded');await capture(page,'audit-canceled')
  for(const theme of['light','dark']){if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:theme==='dark'?'Use dark theme':'Use light theme'}).click();await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='130%');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();violations.push(...scan.violations.map(v=>({name:'audit-scaled-canceled',theme,id:v.id})));const filename=resolve(output,'scaled-canceled-'+theme+'-phone.png');await page.screenshot({path:filename});captures.push(filename)}await page.evaluate(()=>document.documentElement.style.fontSize='');await page.setViewportSize({width:1360,height:960})
  const afterMatcher=url=>url.pathname==='/account/operations/audit'&&url.searchParams.get('limit')==='100'&&url.searchParams.has('after');await page.route(afterMatcher,route=>route.abort('failed'),{times:1});await page.getByRole('button',{name:'Export audit',exact:true}).click();await expect(page.locator('.history-export [role=status]')).toContainText('Could not reach LongHorn');await page.unroute(afterMatcher);await capture(page,'audit-network-error');assert.equal(downloads,beforeFailed)
  const navigation=await hold(page);await page.getByRole('button',{name:'Export audit',exact:true}).click();await waitFor(()=>navigation.entered);await go(page,'#/commands');await navigation.finish();assert.equal(downloads,beforeFailed)
  await go(page,'#/audit');const scope=await hold(page);await page.getByRole('button',{name:'Export audit',exact:true}).click();await waitFor(()=>scope.entered);await go(page,'#/audit/'+second.delivery.id);await scope.finish();assert.equal(downloads,beforeFailed)
  await go(page,'#/audit');const revoked=await hold(page);await page.getByRole('button',{name:'Export audit',exact:true}).click();await waitFor(()=>revoked.entered);await store.setUserRole('audit.operator','numbers-operator',false);await revoked.finish(false);await expect(page.getByRole('heading',{name:'Sign in to LongHorn',exact:true})).toBeVisible();assert.equal(downloads,beforeFailed)
  await store.setUserRole('audit.operator','numbers-operator',true);await login();operatorCookie=await cookie(context);await go(page,'#/audit')
  const savedCookies=await context.cookies(),switched=await hold(page);await page.getByRole('button',{name:'Export audit',exact:true}).click();await waitFor(()=>switched.entered);await context.addCookies(await memberContext.cookies());await switched.finish(false);await expect(page.getByRole('heading',{name:'Sign in to LongHorn',exact:true})).toBeVisible();await expect(page.locator('#notice')).toContainText('active account changed');assert.equal(await cookie(context),memberCookie);assert.equal(downloads,beforeFailed)
  await context.addCookies(savedCookies);await page.reload();await expect(page.getByRole('heading',{name:'Your commands',exact:true})).toBeVisible();await go(page,'#/audit');const expired=await hold(page);await page.getByRole('button',{name:'Export audit',exact:true}).click();await waitFor(()=>expired.entered);assert.equal((await request('/sessions/revoke',{scope:'all'})).status,200);await expired.finish(false);await expect(page.getByRole('heading',{name:'Sign in to LongHorn',exact:true})).toBeVisible();assert.equal(downloads,beforeFailed)
  assert.ok(requests.every(row=>row.viewer===actor));assert.deepEqual(errors,[]);assert.deepEqual(violations,[]);await writeFile(resolve(output,'accessibility.json'),JSON.stringify({captures,violations},null,2));await writeFile(resolve(output,'audit-export-proof.json'),JSON.stringify({nativeApiRecords:records.length,scopedRecords:scoped.end.count,outcomes:[...new Set(all.records.map(row=>row.outcome))],captures:captures.length,noFailedOrCanceledDownloads:true},null,2))
  console.log('Recovery audit export: actual attributed native API records, all/scoped 100+ pagination, all four outcomes, retained audit after delivery pruning, metadata-only downloads, cancellation/navigation/scope, fresh role/session/viewer denial and '+captures.length+' accessible captures verified.')
}finally{for(const held of holds)held.release();await browser?.close();await app?.close();await outgoing?.close();await db?.close();await owner?.close();await sandbox?.stop()}
