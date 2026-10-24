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
import { PostgresAuthStore } from '../packages/auth/dist/postgres.js'
import { createPostgresApp } from '../examples/postgres/dist/app.js'
import { loadConsoleAssets } from '../examples/postgres/dist/console-assets.js'

const output=resolve(process.env.LONGHORN_QA_DIR??'.artifacts/console'),password='owned browser account password',violations=[],errors=[],captures=[]
let sandbox,owner,broker,app,browser,available=true
async function port(){const socket=createServer();await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve)});const value=socket.address().port;await new Promise(resolve=>socket.close(resolve));return value}
const waitFor=async predicate=>{const deadline=Date.now()+20000;while(Date.now()<deadline){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,30))}throw new Error('Console condition did not settle')}
async function ready(page){await expect(page.locator('#main')).toHaveAttribute('aria-busy','false')}
async function go(page,hash){await page.evaluate(value=>{location.hash=value},hash);await expect(page.locator('#main')).toHaveAttribute('data-route',hash);await ready(page)}
async function capture(page,name,{allWidths=true,busy=false}={}){
  if(busy)await expect(page.locator('#main')).toHaveAttribute('aria-busy','true');else await ready(page)
  for(const theme of ['light','dark']){
    if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:theme==='dark'?'Use dark theme':'Use light theme'}).click()
    for(const [width,height,label] of allWidths?[[1360,960,'desktop'],[390,844,'phone']]:[[1360,960,'desktop']]){
      await page.setViewportSize({width,height});if(!busy)await ready(page)
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Console overflows '+name+' '+label)
      const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()
      violations.push(...result.violations.map(value=>({screen:name,theme,width,id:value.id,targets:value.nodes.map(node=>node.target)})))
      const filename=resolve(output,name+'-'+theme+'-'+label+'.png');await page.mouse.move(0,0);await page.screenshot({path:filename,fullPage:true});captures.push(filename)
    }
  }
  await writeFile(resolve(output,'accessibility.json'),JSON.stringify({violations,captures},null,2));await page.setViewportSize({width:1360,height:960});console.log('Console QA captured: '+name)
}
async function register(page,username){
  await go(page,'#/register');await expect(page.getByRole('heading',{name:'Create your account'})).toBeVisible()
  if(username==='console.member')await capture(page,'create-account')
  await page.getByLabel('Username',{exact:true}).fill(username);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Create account',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Your commands',exact:true})).toBeVisible();await ready(page)
}
try{
  await mkdir(output,{recursive:true});sandbox=await startAccountOperationsSandbox();owner=await openPostgres({connectionString:sandbox.ownerUrl})
  broker=new Miniflare({modules:true,scriptPath:fileURLToPath(new URL('../examples/outbox-worker/dist/index.js',import.meta.url)),compatibilityDate:'2025-07-18',cf:false,host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE),
    queueProducers:{MESSAGES:'console-commands'},queueConsumers:{'console-commands':{maxBatchSize:10,maxBatchTimeout:0,maxRetries:2}},durableObjects:{COMMANDS:{className:'CommandStore',useSQLite:true},RECEIPTS:{className:'ReceiptStore',useSQLite:true}}})
  await broker.ready;const publisher=createQueuePublisher(await broker.getQueueProducer('MESSAGES')),selected=await port(),origin='http://127.0.0.1:'+selected
  app=createPostgresApp({console:await loadConsoleAssets(),openDatabase:()=>openPostgres({connectionString:sandbox.appUrl}),workerEnabled:false,schedulerEnabled:false,
    accounts:{origin,secure:false,sessionTtlMs:28800000,passwords:createScryptPasswordHasher(),passwordChanges:true},operations:{publisher:{async publish(message,context){if(!available)throw new Error('Owned publisher unavailable');await publisher.publish(message,context)}},readReceipt:id=>broker.dispatchFetch('http://receipts/receipts/'+id)}})
  const server=await app.listen(nodeRuntime,{hostname:'127.0.0.1',port:selected}),url=server.url+'/console'
  const shell=await fetch(url);assert.equal(shell.status,200);assert.match(shell.headers.get('content-security-policy'),/script-src 'self'/);assert.equal(shell.headers.get('x-content-type-options'),'nosniff');assert.equal(shell.headers.get('cache-control'),'no-store')
  browser=await chromium.launch({headless:true})
  const memberContext=await browser.newContext({viewport:{width:1360,height:960},colorScheme:'light',reducedMotion:'reduce'}),operatorContext=await browser.newContext({viewport:{width:1360,height:960},colorScheme:'light',reducedMotion:'reduce'})
  const member=await memberContext.newPage(),operator=await operatorContext.newPage()
  for(const page of [member,operator])page.on('pageerror',error=>errors.push(error.message))
  await member.goto(url);await ready(member);await capture(member,'welcome')
  await member.locator('#main').focus()
  for(let count=0;count<10&&!await member.locator('.skip').evaluate(element=>element===document.activeElement);count++)await member.keyboard.press('Shift+Tab')
  await expect(member.locator('.skip')).toBeFocused();const previousHash=await member.evaluate(()=>location.hash);await member.keyboard.press('Enter');assert.equal(await member.evaluate(()=>location.hash),previousHash);await expect(member.locator('#main')).toBeFocused()
  await go(member,'#/login');await capture(member,'sign-in')
  await register(member,'console.member');await capture(member,'empty-history')
  await operator.goto(url);await ready(operator);await register(operator,'console.operator')
  const granted=await new PostgresAuthStore(owner).setUserRole('console.operator','numbers-operator',true);assert.equal(granted.status,'updated')
  await operator.reload();await ready(operator);await go(operator,'#/login');await operator.getByLabel('Username',{exact:true}).fill('console.operator');await operator.getByLabel('Password',{exact:true}).fill(password);await operator.getByRole('button',{name:'Sign in',exact:true}).click();await expect(operator.getByRole('link',{name:'Deliveries',exact:true})).toBeVisible()
  await go(operator,'#/audit');await capture(operator,'empty-audit')
  assert.ok(!(await member.evaluate(()=>document.cookie)).includes('longhorn_dev'))
  const cookies=await memberContext.cookies();assert.ok(cookies.some(value=>value.name==='longhorn_dev'&&value.httpOnly&&value.sameSite==='Strict'))
  assert.equal(await member.evaluate(()=>sessionStorage.length),0);assert.deepEqual(await member.evaluate(()=>Object.keys(localStorage)),['longhorn-theme'])
  await go(member,'#/new');await capture(member,'create-command')
  await member.getByLabel('Numbers',{exact:true}).fill('4, 8, 15');await member.getByRole('button',{name:'Create command',exact:true}).click();await expect(member.getByRole('heading',{name:/^Command /})).toBeVisible();await ready(member)
  const commandId=(await member.evaluate(()=>location.hash)).split('/').at(-1)
  await waitFor(async()=>{await member.getByRole('button',{name:'Refresh status'}).click();await ready(member);return await member.getByText('Delivered',{exact:true}).count()&&await member.getByText('27',{exact:true}).count()})
  await capture(member,'command-receipt')
  await go(member,'#/commands');await expect(member.getByRole('link',{name:'Command '+commandId.slice(0,8),exact:true})).toBeVisible();await capture(member,'command-history')
  await member.reload();await ready(member);await expect(member.getByRole('link',{name:'Command '+commandId.slice(0,8),exact:true})).toBeVisible()
  // Hold a real completed API response to inspect the actual loading state.
  let releaseHistory,historyArrived=false
  const historyGate=new Promise(resolve=>{releaseHistory=resolve})
  await member.route('**/account/commands?*',async route=>{const response=await route.fetch();historyArrived=true;await historyGate;await route.fulfill({response})},{times:1})
  const refreshing=member.getByRole('button',{name:'Refresh',exact:true}).click()
  try{await waitFor(()=>historyArrived);await capture(member,'history-loading',{busy:true})}finally{releaseHistory();await refreshing;await ready(member)}
  await member.unroute('**/account/commands?*')
  // Ambiguous browser response: the actual server commits, then the browser loses only the response.
  await go(member,'#/new');await member.getByLabel('Numbers',{exact:true}).fill('11, 13')
  let accepted
  await member.route('**/account/commands',async route=>{if(route.request().method()!=='POST')return route.continue();const response=await route.fetch();accepted=await response.json();await route.abort('failed');await member.unroute('**/account/commands')},{times:1})
  await member.getByRole('button',{name:'Create command',exact:true}).click();await expect(member.getByRole('button',{name:'Try again',exact:true})).toBeVisible();await capture(member,'create-network-error',{allWidths:false})
  await member.getByRole('button',{name:'Try again',exact:true}).click();await expect(member.getByRole('heading',{name:'Command '+accepted.command.id.slice(0,8),exact:true})).toBeVisible()
  assert.equal(Number((await owner.execute({sql:'SELECT count(*) AS count FROM longhorn_pg_example.operator_commands WHERE id=$1',args:[accepted.command.id]})).rows[0].count),1)
  available=false;await go(member,'#/new');await member.getByLabel('Numbers',{exact:true}).fill('18, 22');await member.getByRole('button',{name:'Create command',exact:true}).click();await expect(member.getByRole('heading',{name:/^Command /})).toBeVisible();await ready(member)
  const failedCommand=(await member.evaluate(()=>location.hash)).split('/').at(-1),failedDelivery=String((await owner.execute({sql:'SELECT delivery_id FROM longhorn_pg_example.operator_commands WHERE id=$1',args:[failedCommand]})).rows[0].delivery_id)
  await waitFor(async()=> (await owner.execute({sql:'SELECT state FROM longhorn_queue.jobs WHERE id=$1',args:[failedDelivery]})).rows[0].state==='failed')
  await member.getByRole('button',{name:'Refresh status'}).click();await ready(member);await capture(member,'failed-command')
  await go(operator,'#/deliveries');await expect(operator.getByRole('link',{name:'Delivery '+failedDelivery.slice(0,8),exact:true})).toBeVisible();await capture(operator,'failed-deliveries')
  await operator.getByRole('link',{name:'Delivery '+failedDelivery.slice(0,8),exact:true}).click();await expect(operator.getByRole('button',{name:'Retry delivery',exact:true})).toBeVisible();await capture(operator,'delivery-recovery')
  const intervened=await operator.evaluate(async id=>(await fetch('/account/operations/deliveries/'+id+'/retry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedMaxAttempts:3,additionalAttempts:1,reason:'investigating'})})).status,failedDelivery);assert.equal(intervened,202)
  await waitFor(async()=> (await owner.execute({sql:'SELECT state FROM longhorn_queue.jobs WHERE id=$1',args:[failedDelivery]})).rows[0].state==='failed')
  await operator.getByRole('button',{name:'Retry delivery',exact:true}).click();await expect(operator.getByRole('alert')).toContainText('Delivery changed. Refresh status before retrying.');await capture(operator,'stale-retry',{allWidths:false})
  await operator.getByRole('button',{name:'Refresh status'}).click();await ready(operator)
  available=true;await operator.getByLabel('Reason',{exact:true}).selectOption('provider-restored');await operator.getByRole('button',{name:'Retry delivery',exact:true}).click();await expect(operator.getByRole('status')).toContainText('Retry scheduled.')
  await waitFor(async()=> (await owner.execute({sql:'SELECT state FROM longhorn_queue.jobs WHERE id=$1',args:[failedDelivery]})).rows[0].state==='succeeded')
  await go(operator,'#/audit');await expect(operator.getByText('Provider restored',{exact:true})).toBeVisible();await capture(operator,'recovery-audit')
  await go(member,'#/deliveries');await expect(member.getByRole('heading',{name:'Operator access required'})).toBeVisible();await capture(member,'operator-access-denied')
  await go(member,'#/commands/'+failedCommand);await expect(member.getByText('40',{exact:true})).toBeVisible()
  // Real server-owned expiry: remove sessions and ensure the next request clears private UI.
  const userId=String((await owner.execute("SELECT id FROM longhorn_auth.users WHERE username='console.member'")).rows[0].id)
  await owner.execute({sql:'DELETE FROM longhorn_auth.sessions WHERE user_id=$1',args:[userId]});await member.getByRole('button',{name:'Refresh status'}).click();await expect(member.getByRole('heading',{name:'Sign in to LongHorn'})).toBeVisible();await capture(member,'expired-session')
  await operator.setViewportSize({width:390,height:844});await operator.evaluate(()=>document.documentElement.style.fontSize='130%');assert.ok(await operator.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await operator.screenshot({path:resolve(output,'scaled-text-phone.png'),fullPage:true});captures.push(resolve(output,'scaled-text-phone.png'))
  assert.deepEqual(errors,[]);await writeFile(resolve(output,'accessibility.json'),JSON.stringify({violations,captures},null,2));assert.deepEqual(violations,[])
  console.log('Console browser: actual signup/session/history, real broker receipts, ambiguous-response replay, member/operator policy, outage/retry/audit, expiry, keyboard focus, both themes, scaled text and mobile screenshots verified.')
}finally{
  try{await browser?.close()}finally{try{await app?.close()}finally{try{await broker?.dispose()}finally{try{await owner?.close()}finally{await sandbox?.stop()}}}}
}
