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
import { createPostgresApp } from '../examples/postgres/dist/app.js'
import { loadConsoleAssets } from '../examples/postgres/dist/console-assets.js'

const output=resolve(process.env.LONGHORN_ACCOUNT_QA_DIR??'.artifacts/console/account')
const password='owned browser account password',replacement='a different browser password 🐮 ',finalPassword='a final browser password with spaces '
const errors=[],violations=[],captures=[]
let sandbox,browser
const apps=[]
async function port(){const socket=createServer();await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve)});const result=socket.address().port;await new Promise(resolve=>socket.close(resolve));return result}
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Account request did not arrive')),20000)})])}finally{clearTimeout(timer)}}
async function ready(page){await expect(page.locator('#main')).toHaveAttribute('aria-busy','false')}
async function go(page,hash){await page.evaluate(value=>{location.hash=value},hash);await expect(page.locator('#main')).toHaveAttribute('data-route',hash);await ready(page)}
async function capture(page,name){
  await ready(page)
  for(const theme of ['light','dark']){
    if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:theme==='dark'?'Use dark theme':'Use light theme'}).click()
    for(const [width,height,label]of [[1360,960,'desktop'],[390,844,'phone']]){
      await page.setViewportSize({width,height})
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Account screen overflows '+name+' '+label)
      const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()
      violations.push(...result.violations.map(value=>({screen:name,theme,width,id:value.id,targets:value.nodes.map(node=>node.target)})))
      const filename=resolve(output,name+'-'+theme+'-'+label+'.png');await page.mouse.move(0,0);await page.screenshot({path:filename,fullPage:true});captures.push(filename)
    }
  }
  await writeFile(resolve(output,'accessibility.json'),JSON.stringify({violations,captures},null,2));await page.setViewportSize({width:1360,height:960})
  console.log('Account QA captured: '+name)
}
async function signIn(page,username,secret){
  await go(page,'#/login');await page.getByLabel('Username',{exact:true}).fill(username);await page.getByLabel('Password',{exact:true}).fill(secret);await page.getByRole('button',{name:'Sign in',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Your commands',exact:true})).toBeVisible();await ready(page)
}
async function fill(page,current,next,confirm=next){
  await page.getByLabel('Current password',{exact:true}).fill(current);await page.getByLabel('New password',{exact:true}).fill(next);await page.getByLabel('Confirm new password',{exact:true}).fill(confirm)
}
async function emptyPasswords(page){assert.deepEqual(await page.locator('input[type=password]').evaluateAll(inputs=>inputs.map(input=>input.value)),['','',''])}
async function submit(page){await page.getByRole('button',{name:'Change password',exact:true}).click()}
async function startHost(passwordChanges){
  const selected=await port(),origin='http://127.0.0.1:'+selected
  const app=createPostgresApp({console:await loadConsoleAssets(),openDatabase:()=>openPostgres({connectionString:sandbox.appUrl}),workerEnabled:false,schedulerEnabled:false,
    accounts:{origin,secure:false,sessionTtlMs:28800000,passwords:createScryptPasswordHasher(),passwordChanges,sessionControls:passwordChanges},
    operations:{publisher:{async publish(){throw new Error('Account gate must not publish commands')}},async readReceipt(){throw new Error('Account gate must not read receipts')}}})
  apps.push(app);const server=await app.listen(nodeRuntime,{hostname:'127.0.0.1',port:selected});return server.url+'/console'
}
try{
  await mkdir(output,{recursive:true});sandbox=await startAccountOperationsSandbox()
  const url=await startHost(true),disabledUrl=await startHost(false)
  browser=await chromium.launch({headless:true})
  async function page(){const context=await browser.newContext({viewport:{width:1360,height:960},colorScheme:'light',reducedMotion:'reduce'});const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await ready(page);return page}
  const member=await page(),peer=await page();let requests=0
  member.on('request',request=>{if(new URL(request.url()).pathname==='/account/password'&&request.method()==='POST')requests++})
  await go(member,'#/account');await expect(member.getByLabel('Current password',{exact:true})).toHaveCount(0)
  await go(member,'#/register');await member.getByLabel('Username',{exact:true}).fill('account.member');await member.getByLabel('Password',{exact:true}).fill(password);await member.getByRole('button',{name:'Create account',exact:true}).click();await expect(member.getByRole('heading',{name:'Your commands',exact:true})).toBeVisible()
  await go(member,'#/account');await expect(member.getByRole('link',{name:'Account',exact:true})).toHaveAttribute('aria-current','page');await capture(member,'account')
  assert.equal(await member.getByLabel('Current password',{exact:true}).getAttribute('autocomplete'),'current-password')
  assert.equal(await member.getByLabel('New password',{exact:true}).getAttribute('autocomplete'),'new-password')
  await member.getByLabel('Current password',{exact:true}).focus();await member.keyboard.press('Tab');await expect(member.getByLabel('New password',{exact:true})).toBeFocused();await member.keyboard.press('Tab');await expect(member.getByLabel('Confirm new password',{exact:true})).toBeFocused();await member.keyboard.press('Tab');await expect(member.getByRole('button',{name:'Change password',exact:true})).toBeFocused()
  // Session controls use the same actual account, plus an unrelated account.
  const stranger=await page();await go(stranger,'#/register');await stranger.getByLabel('Username',{exact:true}).fill('account.stranger');await stranger.getByLabel('Password',{exact:true}).fill(password);await stranger.getByRole('button',{name:'Create account',exact:true}).click();await expect(stranger.getByRole('heading',{name:'Your commands',exact:true})).toBeVisible()
  await signIn(peer,'account.member',password)
  let sessionRequests=0;member.on('request',request=>{if(new URL(request.url()).pathname==='/account/sessions/revoke'&&request.method()==='POST')sessionRequests++})
  let releaseSessions,sessionsArrived
  const sessionsGate=new Promise(resolve=>{releaseSessions=resolve}),sessionsArrival=new Promise(resolve=>{sessionsArrived=resolve})
  await member.route('**/account/sessions/revoke',async route=>{const response=await route.fetch();assert.equal(response.status(),200);assert.deepEqual(await response.json(),{revokedSessions:1});sessionsArrived();await sessionsGate;await route.fulfill({response})},{times:1})
  await fill(member,password,replacement);await member.getByRole('button',{name:'End other sessions',exact:true}).click()
  try{
    await bounded(sessionsArrival);await emptyPasswords(member);await expect(member.getByRole('button',{name:'Change password',exact:true})).toBeDisabled();await expect(member.getByRole('button',{name:'Sign out everywhere',exact:true})).toBeDisabled();await expect(member.getByRole('button',{name:'Sign out',exact:true})).toBeDisabled()
    await member.locator('form').dispatchEvent('submit');await member.getByRole('button',{name:'End other sessions',exact:true}).dispatchEvent('click');assert.equal(requests,0);assert.equal(sessionRequests,1)
    await go(member,'#/new');await go(member,'#/account');await expect(member.getByRole('button',{name:'Change password',exact:true})).toBeDisabled();await capture(member,'sessions-pending')
  }finally{releaseSessions()}
  await expect(member.locator('#notice')).toContainText('Ended 1 other session.');await expect(member.getByRole('button',{name:'Change password',exact:true})).toBeEnabled();await member.unroute('**/account/sessions/revoke');await capture(member,'other-sessions-ended')
  await go(peer,'#/new');await peer.evaluate(()=>{location.hash='#/commands'});await expect(peer.getByRole('heading',{name:'Sign in to LongHorn'})).toBeVisible()
  await go(stranger,'#/new');await go(stranger,'#/commands');await expect(stranger.getByRole('heading',{name:'Your commands',exact:true})).toBeVisible()
  await member.getByRole('button',{name:'End other sessions',exact:true}).click();await expect(member.locator('#notice')).toContainText('No other active sessions to end.')
  await signIn(peer,'account.member',password);await member.getByRole('button',{name:'Sign out everywhere',exact:true}).click();await expect(member.locator('#notice')).toContainText('Signed out everywhere.');await expect(member.getByRole('heading',{name:'Sign in to LongHorn'})).toBeVisible();await expect(member.locator('#sidebar')).toBeHidden();await capture(member,'signed-out-everywhere')
  await go(peer,'#/new');await peer.evaluate(()=>{location.hash='#/commands'});await expect(peer.getByRole('heading',{name:'Sign in to LongHorn'})).toBeVisible()
  assert.equal(await stranger.evaluate(async()=>(await fetch('/account/session')).status),200)
  await signIn(member,'account.member',password);await go(member,'#/account')
  // The server really commits all-device revocation before its response is lost.
  await member.route('**/account/sessions/revoke',async route=>{const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed')},{times:1})
  const beforeSessionLoss=sessionRequests;await member.getByRole('button',{name:'Sign out everywhere',exact:true}).click();await expect(member.locator('#notice')).toContainText('Could not confirm the session change.');await expect(member.getByRole('heading',{name:'Sign in to LongHorn'})).toBeVisible();await capture(member,'session-change-unconfirmed');assert.equal(sessionRequests,beforeSessionLoss+1);await member.unroute('**/account/sessions/revoke')
  await signIn(member,'account.member',password);await go(member,'#/account')
  const inputHandle=await member.getByLabel('Current password',{exact:true}).elementHandle();await fill(member,password,replacement);await go(member,'#/new');assert.equal(await inputHandle.evaluate(input=>input.value),'');await inputHandle.dispose();await go(member,'#/account');await emptyPasswords(member)
  await fill(member,password,replacement,'a mismatching browser password');await submit(member);await expect(member.getByRole('alert')).toContainText('do not match');await expect(member.getByLabel('Confirm new password',{exact:true})).toBeFocused();assert.equal(requests,0);await capture(member,'confirmation-error')
  await fill(member,password,'🐮'.repeat(8));await submit(member);await expect(member.getByRole('alert')).toContainText('15–128 characters');assert.equal(requests,0)
  await fill(member,password,password);await submit(member);await expect(member.getByRole('alert')).toContainText('different from your current');assert.equal(requests,0)
  await fill(member,'wrong current password',replacement);await submit(member);await expect(member.getByRole('alert')).toContainText('current password was not correct');await expect(member.getByRole('button',{name:'Sign out',exact:true})).toBeEnabled();await emptyPasswords(member);assert.equal(requests,1);await capture(member,'wrong-current-password')
  // Pass an invalid replacement to the actual server after client validation.
  await member.route('**/account/password',route=>route.continue({postData:JSON.stringify({currentPassword:password,nextPassword:'short'})}),{times:1})
  await fill(member,password,replacement);await submit(member);await expect(member.getByRole('alert')).toContainText('password was not accepted');await emptyPasswords(member);await member.unroute('**/account/password')
  await signIn(peer,'account.member',password)
  // The real server commits while its response is held. Navigation cannot issue
  // a second mutation or sign in before the first browser request settles.
  let release,arrived
  const gate=new Promise(resolve=>{release=resolve}),arrival=new Promise(resolve=>{arrived=resolve})
  await member.route('**/account/password',async route=>{const response=await route.fetch();assert.equal(response.status(),204);arrived();await gate;await route.fulfill({response})},{times:1})
  await fill(member,password,replacement);const before=requests;await submit(member)
  try{
    await bounded(arrival);await emptyPasswords(member);await expect(member.getByRole('button',{name:'Changing password…',exact:true})).toBeDisabled();await expect(member.getByRole('button',{name:'Sign out',exact:true})).toBeDisabled()
    await member.locator('form').dispatchEvent('submit');assert.equal(requests,before+1)
    await go(member,'#/new');await go(member,'#/account');await emptyPasswords(member);await expect(member.getByRole('button',{name:'Changing password…',exact:true})).toBeDisabled();await capture(member,'change-pending')
    await member.evaluate(()=>{location.hash='#/commands'});await expect(member.getByRole('heading',{name:'Sign in to LongHorn'})).toBeVisible();await expect(member.getByRole('button',{name:'Sign in',exact:true})).toBeDisabled()
    await go(peer,'#/new');await peer.evaluate(()=>{location.hash='#/commands'});await expect(peer.getByRole('heading',{name:'Sign in to LongHorn'})).toBeVisible()
  }finally{release()}
  await expect(member.getByRole('status')).toContainText('Password changed.');await expect(member.getByRole('button',{name:'Sign in',exact:true})).toBeEnabled();await expect(member.locator('#sidebar')).toBeHidden();await expect(member.getByLabel('Password',{exact:true})).toHaveValue('');assert.equal(requests,before+1);await capture(member,'password-changed');await member.unroute('**/account/password')
  await member.getByLabel('Username',{exact:true}).fill('account.member');await member.getByLabel('Password',{exact:true}).fill(password);await member.getByRole('button',{name:'Sign in',exact:true}).click();await expect(member.getByRole('alert')).toContainText('Invalid credentials');await signIn(member,'account.member',replacement)
  // A 401 from a revoked initiating session must clear private account UI.
  await go(member,'#/account');assert.equal(await member.evaluate(async()=> (await fetch('/account/logout-all',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status),204)
  await fill(member,replacement,finalPassword);await submit(member);await expect(member.getByRole('status')).toContainText('session could not be verified');await expect(member.getByRole('heading',{name:'Sign in to LongHorn'})).toBeVisible();await expect(member.getByLabel('Current password',{exact:true})).toHaveCount(0);await capture(member,'expired-session')
  await signIn(member,'account.member',replacement);await go(member,'#/account')
  // Losing the committed response must never trigger a password replay.
  await member.route('**/account/password',async route=>{const response=await route.fetch();assert.equal(response.status(),204);await route.abort('failed')},{times:1})
  const beforeLost=requests;await fill(member,replacement,finalPassword);await submit(member);await expect(member.getByRole('status')).toContainText('Could not confirm the password change.');await expect(member.getByRole('status')).toContainText('try your previous password');await expect(member.getByRole('heading',{name:'Sign in to LongHorn'})).toBeVisible();assert.equal(requests,beforeLost+1);await capture(member,'unconfirmed-change');assert.equal(requests,beforeLost+1);await member.unroute('**/account/password');await signIn(member,'account.member',finalPassword)
  // A real, delayed rejection may finish after the form has been left.
  await go(member,'#/account');let releaseWrong,wrongArrived
  const wrongGate=new Promise(resolve=>{releaseWrong=resolve}),wrongArrival=new Promise(resolve=>{wrongArrived=resolve})
  await member.route('**/account/password',async route=>{const response=await route.fetch();assert.equal(response.status(),401);wrongArrived();await wrongGate;await route.fulfill({response})},{times:1})
  await fill(member,'wrong current password again',replacement);await submit(member)
  try{await bounded(wrongArrival);await go(member,'#/new')}finally{releaseWrong()}
  await expect(member.getByRole('status')).toContainText('current password was not correct');await expect(member.getByRole('heading',{name:'Create a command',exact:true})).toBeVisible();await expect(member.getByRole('button',{name:'Sign out',exact:true})).toBeEnabled();await member.unroute('**/account/password')
  // Existing deployments that have not enabled the capability show no form.
  const disabled=await page();await disabled.goto(disabledUrl);await ready(disabled);await signIn(disabled,'account.member',finalPassword);await go(disabled,'#/account');await expect(disabled.getByText('Password changes are unavailable on this host.',{exact:true})).toBeVisible();await expect(disabled.locator('input[type=password]')).toHaveCount(0);await expect(disabled.getByRole('button',{name:'End other sessions',exact:true})).toHaveCount(0);await capture(disabled,'capability-disabled')
  // Actual durable account throttling retains a valid session and clears fields.
  const limited=await page();await go(limited,'#/register');await limited.getByLabel('Username',{exact:true}).fill('account.limited');await limited.getByLabel('Password',{exact:true}).fill(password);await limited.getByRole('button',{name:'Create account',exact:true}).click();await expect(limited.getByRole('heading',{name:'Your commands',exact:true})).toBeVisible();await go(limited,'#/account')
  for(let attempt=0;attempt<10;attempt++){await fill(limited,'wrong current password',replacement);await submit(limited);await expect(limited.getByRole('alert')).toContainText('current password was not correct');await expect(limited.getByRole('button',{name:'Change password',exact:true})).toBeEnabled()}
  await fill(limited,'wrong current password',replacement);await submit(limited);await expect(limited.getByRole('alert')).toContainText('Too many password attempts. Try again in');await emptyPasswords(limited);await expect(limited.getByRole('button',{name:'Sign out',exact:true})).toBeEnabled();await capture(limited,'password-rate-limit')
  await go(member,'#/account');await fill(member,finalPassword,replacement)
  for(const theme of ['light','dark']){
    if(await member.locator('html').getAttribute('data-theme')!==theme)await member.getByRole('button',{name:theme==='dark'?'Use dark theme':'Use light theme'}).click()
    await member.setViewportSize({width:390,height:844});await member.evaluate(()=>document.documentElement.style.fontSize='130%');assert.ok(await member.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
    const result=await new AxeBuilder({page:member}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();violations.push(...result.violations.map(value=>({screen:'scaled-account',theme,width:390,id:value.id})))
    const filename=resolve(output,'scaled-account-'+theme+'-phone.png');await member.screenshot({path:filename,fullPage:true});captures.push(filename)
  }
  // pagehide clears even a detached field; a restored document reloads its session.
  const oldField=await member.getByLabel('Current password',{exact:true}).elementHandle();await member.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide')));assert.equal(await oldField.evaluate(input=>input.value),'');assert.equal(await member.locator('#main').textContent(),'');await oldField.dispose();await member.reload();await ready(member);await emptyPasswords(member)
  for(const page of [member,peer,disabled,limited,stranger]){
    assert.equal(await page.evaluate(()=>sessionStorage.length),0)
    assert.ok((await page.evaluate(()=>Object.keys(localStorage))).every(key=>key==='longhorn-theme'))
    assert.ok(!(await page.evaluate(()=>document.cookie)).includes('longhorn_dev'))
  }
  let sessionReads=0;member.on('request',request=>{if(new URL(request.url()).pathname==='/account/session')sessionReads++})
  await fill(member,finalPassword,replacement);const readsBeforeBack=sessionReads
  await member.goto(new URL('/console/app.css',url).href);await member.goBack();await expect(member.getByRole('heading',{name:'Your account',exact:true})).toBeVisible();await ready(member);await emptyPasswords(member);assert.ok(sessionReads>readsBeforeBack,'Back navigation did not recheck the session')
  // Exercise the real 15-second browser deadline, then release a late native
  // success. The UI must stay uncertain and never replay or announce success.
  let releaseLate,lateArrived,lateDelivered
  const lateGate=new Promise(resolve=>{releaseLate=resolve}),lateArrival=new Promise(resolve=>{lateArrived=resolve}),lateDelivery=new Promise(resolve=>{lateDelivered=resolve})
  await member.route('**/account/password',async route=>{const response=await route.fetch();assert.equal(response.status(),204);lateArrived();await lateGate;try{await route.fulfill({response})}finally{lateDelivered()}},{times:1})
  const timeoutPassword='a browser password changed after a timeout ',beforeTimeout=requests
  await fill(member,finalPassword,timeoutPassword);await submit(member)
  try{await bounded(lateArrival);await expect(member.getByRole('status')).toContainText('Could not confirm the password change.',{timeout:20000})}finally{releaseLate()}
  await bounded(lateDelivery);assert.equal(requests,beforeTimeout+1);await expect(member.getByRole('heading',{name:'Sign in to LongHorn'})).toBeVisible();await expect(member.getByLabel('Password',{exact:true})).toHaveValue('');await capture(member,'change-timed-out');await member.unroute('**/account/password');await signIn(member,'account.member',timeoutPassword)
  // Password/session handlers must retain viewer-change guidance and leave the
  // valid other-account cookie alone, including the password-specific 401 path.
  const activeCookies=await member.context().cookies(),otherCookies=await stranger.context().cookies()
  await go(member,'#/account');await fill(member,timeoutPassword,replacement);await member.context().addCookies(otherCookies)
  await submit(member);await expect(member.locator('#notice')).toContainText('active account changed');await expect(member.getByRole('heading',{name:'Sign in to LongHorn'})).toBeVisible()
  assert.ok((await member.context().cookies()).find(value=>value.name==='longhorn_dev')?.value===otherCookies.find(value=>value.name==='longhorn_dev')?.value,'Password viewer failure changed another account cookie')
  assert.equal(await stranger.evaluate(async()=>(await fetch('/account/session')).status),200)
  await member.context().addCookies(activeCookies);await member.reload();await ready(member);await go(member,'#/account');await member.context().addCookies(otherCookies)
  await member.getByRole('button',{name:'End other sessions',exact:true}).click();await expect(member.locator('#notice')).toContainText('active account changed');await expect(member.getByRole('heading',{name:'Sign in to LongHorn'})).toBeVisible()
  assert.equal(await stranger.evaluate(async()=>(await fetch('/account/session')).status),200)
  await member.context().addCookies(activeCookies);await member.reload();await ready(member)
  await writeFile(resolve(output,'accessibility.json'),JSON.stringify({violations,captures},null,2));assert.deepEqual(errors,[]);assert.deepEqual(violations,[])
  console.log('Console account: actual scrypt/PostgreSQL, scoped session revocation, shared account mutation exclusion, Unicode validation, live 401 session distinction, native revocation, pending navigation, single submission, real throttling, dropped committed response, actual deadline/late success, capability flag, secret clearing, keyboard and '+captures.length+' accessible browser captures verified.')
}finally{
  try{await browser?.close()}finally{try{for(const app of apps.reverse())await app.close()}finally{await sandbox?.stop()}}
}
