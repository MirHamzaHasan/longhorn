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
    accounts:{origin,secure:false,sessionTtlMs:28800000,passwords:createScryptPasswordHasher(),passwordChanges:true,sessionControls:true},operations:{publisher:{async publish(message,context){if(!available)throw new Error('Owned publisher unavailable');await publisher.publish(message,context)}},readReceipt:id=>broker.dispatchFetch('http://receipts/receipts/'+id)}})
  const server=await app.listen(nodeRuntime,{hostname:'127.0.0.1',port:selected}),url=server.url+'/console'
  const shell=await fetch(url);assert.equal(shell.status,200);assert.match(shell.headers.get('content-security-policy'),/script-src 'self'/);assert.equal(shell.headers.get('x-content-type-options'),'nosniff');assert.equal(shell.headers.get('cache-control'),'no-store')
  browser=await chromium.launch({headless:true})
  const memberContext=await browser.newContext({viewport:{width:1360,height:960},colorScheme:'light',reducedMotion:'reduce'}),operatorContext=await browser.newContext({viewport:{width:1360,height:960},colorScheme:'light',reducedMotion:'reduce'})
  const member=await memberContext.newPage(),operator=await operatorContext.newPage(),commandPosts=[]
  member.on('request',request=>{if(new URL(request.url()).pathname==='/account/commands'&&request.method()==='POST')commandPosts.push(request.postDataJSON())})
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
  // An old account's review form must not submit under a newly switched cookie.
  const memberCookies=await memberContext.cookies(),operatorCookies=await operatorContext.cookies()
  const beforeSwitch=await operator.evaluate(async()=> (await(await fetch('/account/commands?scope=mine')).json()).commands.map(value=>value.id))
  await member.getByRole('link',{name:'Run again',exact:true}).click();await expect(member.getByRole('heading',{name:'Run command again',exact:true})).toBeVisible();await expect(member.getByLabel('Numbers',{exact:true})).toHaveValue('4, 8, 15')
  await memberContext.addCookies(operatorCookies)
  const switchedResponse=member.waitForResponse(value=>new URL(value.url()).pathname==='/account/commands'&&value.request().method()==='POST')
  await member.getByRole('button',{name:'Create command',exact:true}).click();assert.equal((await switchedResponse).status(),401)
  await expect(member.getByRole('heading',{name:'Sign in to LongHorn'})).toBeVisible();await expect(member.locator('#notice')).toContainText('active account changed');await capture(member,'viewer-account-changed')
  assert.ok((await memberContext.cookies()).find(value=>value.name==='longhorn_dev').value===operatorCookies.find(value=>value.name==='longhorn_dev').value,'Viewer check changed the other account cookie')
  assert.deepEqual(await operator.evaluate(async()=> (await(await fetch('/account/commands?scope=mine')).json()).commands.map(value=>value.id)),beforeSwitch)
  await memberContext.addCookies(memberCookies);await member.reload();await ready(member)
  // Read requests are bound too: a stale view cannot load the other account's history.
  await memberContext.addCookies(operatorCookies);await member.evaluate(()=>{location.hash='#/commands'});await expect(member.getByRole('heading',{name:'Sign in to LongHorn'})).toBeVisible();await expect(member.locator('#notice')).toContainText('active account changed')
  await memberContext.addCookies(memberCookies);await member.reload();await ready(member);await go(member,'#/commands/'+commandId)
  // A copy is an explicit review, survives deep-link reload and gets a fresh request key.
  const beforeCopy=commandPosts.length
  await member.getByRole('link',{name:'Run again',exact:true}).click();await expect(member.getByRole('heading',{name:'Run command again',exact:true})).toBeVisible();await expect(member.getByLabel('Numbers',{exact:true})).toHaveValue('4, 8, 15');assert.equal(commandPosts.length,beforeCopy)
  await member.reload();await ready(member);await expect(member.getByLabel('Numbers',{exact:true})).toHaveValue('4, 8, 15');await expect(member.locator('.command-source a')).toHaveAttribute('href','#/commands/'+commandId);assert.equal(commandPosts.length,beforeCopy);await capture(member,'rerun-review')
  for(const theme of ['light','dark']){
    if(await member.locator('html').getAttribute('data-theme')!==theme)await member.getByRole('button',{name:theme==='dark'?'Use dark theme':'Use light theme'}).click()
    await member.setViewportSize({width:390,height:844});await member.evaluate(()=>document.documentElement.style.fontSize='130%');assert.ok(await member.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
    const result=await new AxeBuilder({page:member}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();violations.push(...result.violations.map(value=>({screen:'scaled-rerun',theme,width:390,id:value.id})))
    const filename=resolve(output,'scaled-rerun-'+theme+'-phone.png');await member.screenshot({path:filename,fullPage:true});captures.push(filename)
  }
  await member.evaluate(()=>document.documentElement.style.fontSize='');await member.setViewportSize({width:1360,height:960})
  await member.getByLabel('Numbers',{exact:true}).focus();await member.keyboard.press('Tab');await expect(member.getByRole('button',{name:'Create command',exact:true})).toBeFocused()
  await member.getByRole('button',{name:'Create command',exact:true}).click();await expect(member.getByRole('heading',{name:/^Command /})).toBeVisible();await ready(member)
  const copiedId=(await member.evaluate(()=>location.hash)).split('/').at(-1),firstCopy=commandPosts.at(-1)
  assert.notEqual(copiedId,commandId);assert.notEqual(firstCopy.id,commandPosts[0].id);assert.deepEqual(firstCopy.numbers,[4,8,15]);assert.deepEqual(Object.keys(firstCopy).sort(),['id','numbers'])
  await waitFor(async()=>{await member.getByRole('button',{name:'Refresh status'}).click();await ready(member);return await member.getByText('27',{exact:true}).count()})
  // Editing a copy changes only the new submission; a lost accepted response reuses its key.
  await go(member,'#/commands/'+commandId);await member.getByRole('link',{name:'Run again',exact:true}).click();await expect(member.getByLabel('Numbers',{exact:true})).toHaveValue('4, 8, 15');await member.getByLabel('Numbers',{exact:true}).fill('6, 7')
  let acceptedRerun
  await member.route('**/account/commands',async route=>{if(route.request().method()!=='POST')return route.continue();const response=await route.fetch();assert.equal(response.status(),201);acceptedRerun=await response.json();await route.abort('failed')},{times:1})
  await member.getByRole('button',{name:'Create command',exact:true}).click();await expect(member.getByRole('button',{name:'Try again',exact:true})).toBeVisible();const rerunRequest=commandPosts.at(-1);await capture(member,'rerun-network-error');await member.unroute('**/account/commands')
  await member.getByLabel('Numbers',{exact:true}).fill('6\n7');await member.getByRole('button',{name:'Try again',exact:true}).click();await expect(member.getByRole('heading',{name:'Command '+acceptedRerun.command.id.slice(0,8),exact:true})).toBeVisible();assert.equal(commandPosts.at(-1).id,rerunRequest.id);assert.notEqual(rerunRequest.id,firstCopy.id);assert.deepEqual(commandPosts.at(-1).numbers,[6,7])
  assert.equal(Number((await owner.execute({sql:'SELECT count(*) AS count FROM longhorn_pg_example.operator_commands WHERE id=$1',args:[acceptedRerun.command.id]})).rows[0].count),1)
  await waitFor(async()=>{await member.getByRole('button',{name:'Refresh status'}).click();await ready(member);return await member.getByText('13',{exact:true}).count()})
  const sourceRow=(await owner.execute({sql:'SELECT numbers,delivery_id FROM longhorn_pg_example.operator_commands WHERE id=$1',args:[commandId]})).rows[0]
  assert.deepEqual(JSON.parse(String(sourceRow.numbers)),[4,8,15]);assert.notEqual(sourceRow.delivery_id,acceptedRerun.delivery.id)
  // An operator can review an admitted source, but its new command is owned by that operator.
  await go(operator,'#/commands/'+commandId);await operator.getByRole('link',{name:'Run again',exact:true}).click();await expect(operator.getByLabel('Numbers',{exact:true})).toHaveValue('4, 8, 15');await operator.getByRole('button',{name:'Create command',exact:true}).click();await expect(operator.getByRole('heading',{name:/^Command /})).toBeVisible();await ready(operator)
  const operatorCopy=(await operator.evaluate(()=>location.hash)).split('/').at(-1)
  assert.equal(await member.evaluate(async id=>(await fetch('/account/commands/'+id)).status,operatorCopy),404)
  await go(member,'#/new/'+operatorCopy);await expect(member.getByRole('heading',{name:'Original command unavailable',exact:true})).toBeVisible();await expect(member.getByLabel('Numbers',{exact:true})).toHaveCount(0);await capture(member,'rerun-source-unavailable')
  await go(member,'#/new/not-a-command');await expect(member.getByRole('heading',{name:'Invalid command link',exact:true})).toBeVisible()
  // Deliberately corrupt an owned legacy row in the test database; the actual GET
  // still supplies it, and the review refuses coercion rather than inventing numbers.
  const corrupt=await member.evaluate(async()=> (await(await fetch('/account/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),numbers:[3]})})).json()).command.id)
  await owner.execute({sql:'UPDATE longhorn_pg_example.operator_commands SET numbers=$1::jsonb WHERE id=$2',args:['["bad"]',corrupt]})
  await go(member,'#/new/'+corrupt);await expect(member.getByRole('heading',{name:'Cannot copy this command',exact:true})).toBeVisible();await expect(member.getByLabel('Numbers',{exact:true})).toHaveCount(0);await capture(member,'rerun-invalid-source')
  let releaseSource,sourceDone,sourceArrived=false,sourceAborted=false,sourceRouteError
  const sourceGate=new Promise(resolve=>{releaseSource=resolve}),sourceCompletion=new Promise(resolve=>{sourceDone=resolve})
  const sourceFailure=request=>{if(new URL(request.url()).pathname==='/account/commands/'+commandId&&request.failure()?.errorText==='net::ERR_ABORTED')sourceAborted=true}
  member.on('requestfailed',sourceFailure)
  await member.route('**/account/commands/'+commandId,async route=>{
    try{const response=await route.fetch();assert.equal(response.status(),200);sourceArrived=true;await sourceGate;await route.fulfill({response})}
    catch(error){sourceRouteError=error}finally{sourceDone()}
  },{times:1})
  await member.evaluate(id=>{location.hash='#/new/'+id},commandId)
  try{await waitFor(()=>sourceArrived);await capture(member,'rerun-loading',{busy:true});await go(member,'#/commands')}finally{releaseSource();await sourceCompletion}
  if(sourceRouteError){assert.ok(sourceAborted,'Unexpected source route failure');assert.match(sourceRouteError.message,/Route is already handled|Request.*aborted/)}
  member.off('requestfailed',sourceFailure);await member.unroute('**/account/commands/'+commandId);await expect(member.getByRole('heading',{name:'Your commands',exact:true})).toBeVisible();await expect(member.getByLabel('Numbers',{exact:true})).toHaveCount(0)
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
  console.log('Console browser: actual signup/session/history, saved-command reuse, viewer-bound account switching, real broker receipts, ambiguous-response replay, member/operator policy, outage/retry/audit, expiry, keyboard focus, both themes, scaled text and mobile screenshots verified.')
}finally{
  try{await browser?.close()}finally{try{await app?.close()}finally{try{await broker?.dispose()}finally{try{await owner?.close()}finally{await sandbox?.stop()}}}}
}
