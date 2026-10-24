import assert from 'node:assert/strict'
import { chromium,expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createServer } from 'node:net'
import { mkdir,writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Miniflare,Log,LogLevel } from 'miniflare'
import { startAccountOperationsSandbox } from './account-operations-sandbox.mjs'
import { openPostgres } from '../runtimes/node/dist/postgres.js'
import { createScryptPasswordHasher } from '../runtimes/node/dist/passwords.js'
import { nodeRuntime } from '../runtimes/node/dist/index.js'
import { createQueuePublisher } from '../runtimes/workers/dist/outbox.js'
import { Outbox } from '../packages/outbox/dist/index.js'
import { PostgresOutboxStore } from '../packages/outbox/dist/postgres.js'
import { operationData,operationTopic } from '../examples/postgres/dist/operation-contracts.js'
import { createPostgresApp } from '../examples/postgres/dist/app.js'
import { loadConsoleAssets } from '../examples/postgres/dist/console-assets.js'

const output=resolve(process.env.LONGHORN_FOLLOW_QA_DIR??'.artifacts/console/follow'),password='owned command follow password',captures=[],violations=[],errors=[],holds=[]
let sandbox,owner,database,outgoing,broker,app,browser,receiptAvailable=true,commandPosts=0
const sleep=ms=>new Promise(done=>setTimeout(done,ms))
const waitFor=async predicate=>{const deadline=Date.now()+20000;while(Date.now()<deadline){const value=await predicate();if(value)return value;await sleep(20)}throw new Error('Command follow condition did not settle')}
async function freePort(){const socket=createServer();await new Promise((done,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',done)});const port=socket.address().port;await new Promise(done=>socket.close(done));return port}
async function go(page,hash){await page.evaluate(value=>{location.hash=value},hash);await expect(page.locator('#main')).toHaveAttribute('data-route',hash);await expect(page.locator('#main')).toHaveAttribute('aria-busy','false')}
async function register(page,url,username){await page.goto(url+'#/register');await page.getByLabel('Username',{exact:true}).fill(username);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Create account',exact:true}).click();await expect(page.getByRole('heading',{name:'Your commands',exact:true})).toBeVisible()}
async function capture(page,name){
  for(const theme of['light','dark']){
    if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:theme==='dark'?'Use dark theme':'Use light theme'}).click()
    for(const[width,height,label]of[[1360,960,'desktop'],[390,844,'phone']]){
      await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
      const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();violations.push(...result.violations.map(value=>({name,theme,width,id:value.id})))
      const filename=resolve(output,name+'-'+theme+'-'+label+'.png');await page.mouse.move(0,0);await page.screenshot({path:filename,fullPage:true});captures.push(filename)
    }
  }
  await page.setViewportSize({width:1360,height:960});console.log('Follow QA captured: '+name)
}
async function holdRead(page,id){
  let release;const gate=new Promise(done=>{release=done}),held={entered:false,done:false,error:undefined,aborted:false,release}
  const path='/account/commands/'+id,pattern='**'+path
  page.on('requestfailed',request=>{if(new URL(request.url()).pathname===path&&request.failure()?.errorText==='net::ERR_ABORTED')held.aborted=true})
  await page.route(pattern,async route=>{try{const response=await route.fetch();assert.equal(response.status(),200);held.entered=true;await gate;try{await route.fulfill({response})}catch(error){if(!held.aborted)throw error}}catch(error){held.error=error}finally{held.done=true}},{times:1})
  held.finish=async()=>{release();await waitFor(()=>held.done);await page.unroute(pattern);if(held.error)throw held.error;assert.ok(held.aborted,'Expected cancellation of the held real read')}
  holds.push(held);return held
}
try{
  await mkdir(output,{recursive:true});sandbox=await startAccountOperationsSandbox();owner=await openPostgres({connectionString:sandbox.ownerUrl});database=await openPostgres({connectionString:sandbox.appUrl})
  broker=new Miniflare({modules:true,scriptPath:fileURLToPath(new URL('../examples/outbox-worker/dist/index.js',import.meta.url)),compatibilityDate:'2025-07-18',cf:false,host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE),queueProducers:{MESSAGES:'follow-commands'},queueConsumers:{'follow-commands':{maxBatchSize:10,maxBatchTimeout:0,maxRetries:2}},durableObjects:{COMMANDS:{className:'CommandStore',useSQLite:true},RECEIPTS:{className:'ReceiptStore',useSQLite:true}}})
  await broker.ready;const publisher=createQueuePublisher(await broker.getQueueProducer('MESSAGES')),port=await freePort(),origin='http://127.0.0.1:'+port
  // The gate owns dispatch timing; pending and receipt observations remain actual HTTP/SQL/broker results.
  outgoing=new Outbox({name:operationTopic,schema:operationData,store:new PostgresOutboxStore(database),leaseMs:60000,retryDelayMs:0})
  app=createPostgresApp({console:await loadConsoleAssets(),openDatabase:()=>openPostgres({connectionString:sandbox.appUrl}),workerEnabled:false,schedulerEnabled:false,accounts:{origin,secure:false,sessionTtlMs:28800000,passwords:createScryptPasswordHasher()},operations:{readReceipt:id=>receiptAvailable?broker.dispatchFetch('http://receipts/receipts/'+id):Promise.resolve(new Response(JSON.stringify({error:'Owned receipt service unavailable'}),{status:503,headers:{'Content-Type':'application/json'}}))}})
  await app.listen(nodeRuntime,{hostname:'127.0.0.1',port});const url=origin+'/console'
  browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1360,height:960},reducedMotion:'reduce'}),peerContext=await browser.newContext(),page=await context.newPage(),peer=await peerContext.newPage(),requests=[]
  for(const p of[page,peer])p.on('pageerror',error=>errors.push(error.message))
  page.on('request',request=>{const path=new URL(request.url()).pathname;if(path==='/account/commands'&&request.method()==='POST')++commandPosts;requests.push({path,method:request.method(),viewer:request.headers()['x-longhorn-viewer']})})
  await register(page,url,'follow.alice');await register(peer,url,'follow.bobby')
  const create=async key=>page.evaluate(async key=>{const session=await(await fetch('/account/session')).json(),response=await fetch('/account/commands',{method:'POST',headers:{'Content-Type':'application/json','X-LongHorn-Viewer':session.user.id},body:JSON.stringify({id:key,numbers:[6,9,15]})});if(response.status!==201)throw new Error('Actual command creation failed');return response.json()},key)
  const progress=page.locator('.follow-updates [role=status]'),readCount=id=>requests.filter(r=>r.method==='GET'&&(r.path==='/account/commands/'+id||r.path==='/account/commands/'+id+'/receipt')).length
  const first=await create('follow-first');await go(page,'#/commands/'+first.command.id);await expect(progress).toContainText('Checking delivery');await capture(page,'following')
  await page.getByRole('button',{name:'Pause updates',exact:true}).focus();await page.keyboard.press('Enter');await expect(progress).toContainText('Updates paused.');const paused=readCount(first.command.id);await sleep(3400);assert.equal(readCount(first.command.id),paused);await capture(page,'paused')
  for(const theme of['light','dark']){if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:theme==='dark'?'Use dark theme':'Use light theme'}).click();await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='130%');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();violations.push(...scan.violations.map(v=>({name:'scaled-paused',theme,id:v.id})));const filename=resolve(output,'scaled-paused-'+theme+'-phone.png');await page.screenshot({path:filename,fullPage:true});captures.push(filename)}
  await page.evaluate(()=>document.documentElement.style.fontSize='');await page.setViewportSize({width:1360,height:960})
  await page.getByRole('button',{name:'Resume updates',exact:true}).click();await page.getByRole('button',{name:'Pause updates',exact:true}).focus();await outgoing.dispatchOnce(publisher)
  await expect(page.locator('.receipt-values')).toContainText('30',{timeout:15000});await expect(progress).toHaveText('Receipt received. Updates stopped.');await expect(page.getByRole('button',{name:'Updates finished',exact:true})).toBeFocused();await expect(page.getByRole('button',{name:'Updates finished',exact:true})).toHaveAttribute('aria-disabled','true');const completed=readCount(first.command.id);await sleep(3400);assert.equal(readCount(first.command.id),completed);assert.equal(commandPosts,1);await capture(page,'receipt-arrived')
  const missing=await create('follow-pruned');await owner.execute({sql:'DELETE FROM longhorn_queue.jobs WHERE queue=$1 AND id=$2',args:['outbox.'+operationTopic,missing.delivery.id]});await go(page,'#/commands/'+missing.command.id);await page.getByRole('button',{name:'Follow updates',exact:true}).click();await expect(progress).toContainText('Delivery metadata is unavailable.',{timeout:15000});await capture(page,'metadata-unavailable')
  const failed=await create('follow-failed');for(let n=0;n<5;n++)await outgoing.dispatchOnce({async publish(){throw new Error('Owned fixture publisher failure')}});await go(page,'#/commands/'+failed.command.id);await page.getByRole('button',{name:'Follow updates',exact:true}).click();await expect(progress).toHaveText('Delivery failed. Updates stopped.',{timeout:15000});await capture(page,'delivery-failed')
  const pending=await create('follow-pending');receiptAvailable=false;await go(page,'#/commands/'+pending.command.id);await page.getByRole('button',{name:'Follow updates',exact:true}).click();await expect(progress).toContainText('Owned receipt service unavailable',{timeout:15000});const unavailable=readCount(pending.command.id);await sleep(3400);assert.equal(readCount(pending.command.id),unavailable);await capture(page,'receipt-service-error');receiptAvailable=true
  await page.getByRole('button',{name:'Try updates',exact:true}).click();const held=await holdRead(page,pending.command.id);await waitFor(()=>held.entered)
  // Visibility is an explicit browser event fixture; the completed network response is real.
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});await expect(progress).toContainText('hidden or offline');await held.finish();const hidden=readCount(pending.command.id);await sleep(3400);assert.equal(readCount(pending.command.id),hidden)
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))});await expect(progress).toContainText('Checking delivery')
  await context.setOffline(true);await expect.poll(()=>page.evaluate(()=>navigator.onLine)).toBe(false);await expect(progress).toContainText('hidden or offline');const offline=readCount(pending.command.id);await sleep(3400);assert.equal(readCount(pending.command.id),offline);await context.setOffline(false);await expect(progress).toContainText('Checking delivery')
  const navigating=await holdRead(page,pending.command.id);await waitFor(()=>navigating.entered);await go(page,'#/new');await navigating.finish();const left=readCount(pending.command.id);await sleep(3400);assert.equal(readCount(pending.command.id),left);await expect(page.getByRole('heading',{name:'Create a command',exact:true})).toBeVisible();await expect(page.locator('#notice')).toBeHidden()
  await go(page,'#/commands/'+pending.command.id);await page.route('**/account/commands/'+pending.command.id,route=>route.abort('failed'),{times:1});await expect(progress).toContainText('Could not reach LongHorn',{timeout:15000});const network=readCount(pending.command.id);await sleep(3400);assert.equal(readCount(pending.command.id),network);await page.unroute('**/account/commands/'+pending.command.id)
  const aliceCookies=await context.cookies(),bobCookies=await peerContext.cookies(),alice=await page.evaluate(async()=>(await(await fetch('/account/session')).json()).user.id)
  await page.getByRole('button',{name:'Try updates',exact:true}).click();await context.addCookies(bobCookies);await expect(page.getByRole('heading',{name:'Sign in to LongHorn',exact:true})).toBeVisible({timeout:15000});await expect(page.locator('#notice')).toContainText('active account changed');assert.equal((await context.cookies()).find(c=>c.name==='longhorn_dev').value,bobCookies.find(c=>c.name==='longhorn_dev').value);assert.equal(await peer.evaluate(async()=>(await fetch('/account/session')).status),200)
  await context.addCookies(aliceCookies);await page.reload();await expect(page.getByRole('heading',{name:'Your commands',exact:true})).toBeVisible();await go(page,'#/commands/'+pending.command.id);await owner.execute({sql:'DELETE FROM longhorn_auth.sessions WHERE user_id=$1',args:[alice]});await expect(page.getByRole('heading',{name:'Sign in to LongHorn',exact:true})).toBeVisible({timeout:15000});await expect(page.locator('#notice')).toContainText('Your session ended');await expect(page.locator('.details')).toHaveCount(0)
  assert.equal(commandPosts,4);assert.ok(requests.filter(r=>r.path==='/account/commands/'+pending.command.id&&r.method==='GET').every(r=>r.viewer===alice));assert.deepEqual(errors,[]);assert.deepEqual(violations,[])
  await writeFile(resolve(output,'accessibility.json'),JSON.stringify({captures,violations},null,2))
  console.log('Command follow: native queued command and broker receipt arrive without refresh; pause/resume and focus, terminal/pruned metadata, real receipt outage/network failure, hidden-event cancellation, actual offline pause, navigation, viewer change and session expiry verified; '+captures.length+' accessible captures.')
}finally{
  for(const held of holds)held.release();await browser?.close();await app?.close();await outgoing?.close();await database?.close();await owner?.close();await broker?.dispose();await sandbox?.stop()
}
