import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { startAccountOperationsSandbox } from './account-operations-sandbox.mjs'
import { openPostgres } from '../runtimes/node/dist/postgres.js'
import { nodeRuntime } from '../runtimes/node/dist/index.js'
import { createScryptPasswordHasher } from '../runtimes/node/dist/passwords.js'
import { createPostgresApp } from '../examples/postgres/dist/app.js'
import { loadConsoleAssets } from '../examples/postgres/dist/console-assets.js'
const output = resolve('.artifacts/console/session-inventory'), password = 'native session inventory password', captures = [], violations = [], errors = [], applications = [], pools = [], gates = []
let sandbox, browser, owner
const freePort = async () => { const server = createServer(); await new Promise(done => server.listen(0, '127.0.0.1', done)); const value = server.address().port; await new Promise(done => server.close(done)); return value }
const ready = async page => { await expect(page.locator('#main')).toHaveAttribute('aria-busy', 'false') }
const account = async page => { await page.evaluate(() => { location.hash = '#/account' }); await expect(page.locator('#main')).toHaveAttribute('data-route', '#/account'); await ready(page) }
const loaded = async page => { await expect(page.locator('.session-inventory')).toHaveAttribute('aria-busy', 'false'); await expect(page.locator('.session-row').first()).toBeVisible() }
async function capture(page, name) {
  await ready(page)
  for (const theme of ['light', 'dark']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Use dark theme' : 'Use light theme' }).click()
    for (const [width, height, label] of [[1360, 960, 'desktop'], [390, 844, 'phone']]) {
      await page.setViewportSize({ width, height }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Session screen overflows')
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze(); violations.push(...result.violations.map(row => ({ name, theme, width, id: row.id })))
      const file = resolve(output, name + '-' + theme + '-' + label + '.png'); await page.screenshot({ path: file, fullPage: true }); captures.push(file)
      assert.ok(await page.locator('.session-inventory button:visible').evaluateAll(buttons => buttons.every(button => button.getBoundingClientRect().height >= 44)), 'Session controls too small')
    }
  }
  await page.setViewportSize({ width: 1360, height: 960 }); console.log('Session inventory captured: ' + name)
}
async function start(enabled) {
  const port = await freePort(), origin = 'http://127.0.0.1:' + port
  const app = createPostgresApp({ console: await loadConsoleAssets(), openDatabase: async () => { const database = await openPostgres({ connectionString: sandbox.appUrl }); pools.push(database); return database }, workerEnabled: false, schedulerEnabled: false,
    accounts: { origin, secure: false, sessionTtlMs: 28800000, passwords: createScryptPasswordHasher(), passwordChanges: true, sessionControls: true, sessionInventory: enabled },
    operations: { publisher: { async publish() { throw new Error('Inventory gate must not publish') } }, async readReceipt() { throw new Error('Inventory gate must not read receipts') } },
  }); applications.push(app); return (await app.listen(nodeRuntime, { hostname: '127.0.0.1', port })).url
}
try {
  await mkdir(output, { recursive: true }); sandbox = await startAccountOperationsSandbox(); owner = await openPostgres({ connectionString: sandbox.ownerUrl })
  const origin = await start(true), disabled = await start(false), api = (path, cookie, value, override = {}) => fetch(origin + '/account' + path, { method: value === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(value === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }), ...override }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) })
  browser = await chromium.launch({ headless: true }); const context = await browser.newContext({ viewport: { width: 1360, height: 960 }, colorScheme: 'light', reducedMotion: 'reduce', timezoneId: 'UTC' }), page = await context.newPage(); page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin + '/console#/register'); await ready(page); await page.getByLabel('Username', { exact: true }).fill('session.member'); await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Create account', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Your commands', exact: true })).toBeVisible()
  const peers = []; let currentCookie = (await context.cookies(origin)).find(row => row.name === 'longhorn_dev'), cookie = currentCookie.name + '=' + currentCookie.value
  for (let index = 0; index < 12; index++) { const response = await api('/login', undefined, { username: 'session.member', password }); assert.equal(response.status, 200); peers.push(response.headers.get('set-cookie').split(';')[0]); await response.json() }
  const listing = await api('/sessions?limit=50', cookie); assert.equal(listing.status, 200); assert.equal(listing.headers.get('Cache-Control'), 'no-store'); const entries = (await listing.json()).sessions; assert.equal(entries.length, 13); assert.equal(entries.filter(row => row.current).length, 1)
  for (const entry of entries) assert.deepEqual(Object.keys(entry).sort(), ['current', 'expiresAt', 'id'])
  assert.equal((await api('/sessions')).status, 401); assert.equal((await api('/session', currentCookie.name + '=' + entries.find(row => row.current).id)).status, 401)
  for (const query of ['?limit=51', '?limit=2&limit=3', '?cursor=invalid', '?owner=foreign']) assert.equal((await api('/sessions' + query, cookie)).status, 400)
  assert.equal((await api('/sessions/end', cookie, { id: 'x' })).status, 400); assert.equal((await api('/sessions/end', cookie, { id: entries[0].id }, { Origin: 'https://wrong.example' })).status, 403)
  assert.equal((await api('/register', undefined, { username: 'session.foreign', password })).status, 201); const foreignLogin = await api('/login', undefined, { username: 'session.foreign', password }), foreignCookie = foreignLogin.headers.get('set-cookie').split(';')[0], foreign = (await (await api('/sessions', foreignCookie)).json()).sessions[0]
  assert.deepEqual(await (await api('/sessions/end', cookie, { id: foreign.id })).json(), { revokedSessions: 0, current: false }); assert.equal((await api('/session', foreignCookie)).status, 200)
  assert.equal((await fetch(disabled + '/account/sessions', { headers: { Cookie: cookie } })).status, 404)

  await account(page); await loaded(page); await expect(page.locator('.session-row')).toHaveCount(10); await expect(page.getByText('This session', { exact: true })).toHaveCount(1); await capture(page, 'active')
  await page.getByRole('button', { name: 'Load more sessions', exact: true }).click(); await expect(page.locator('.session-row')).toHaveCount(13); await expect(page.getByRole('button', { name: 'Refresh sessions', exact: true })).toBeFocused(); await capture(page, 'complete')
  const target = page.locator('.session-row').nth(1); await target.getByRole('button', { name: 'End session 2', exact: true }).click(); await expect(target.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused(); await capture(page, 'confirm')
  await target.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(target.getByRole('button', { name: 'End session 2', exact: true })).toBeFocused()
  let mutations = 0; page.on('request', request => { if (new URL(request.url()).pathname === '/account/sessions/end') mutations++ })
  await target.getByRole('button', { name: 'End session 2', exact: true }).click(); await target.getByRole('button', { name: 'End session', exact: true }).click(); await loaded(page); await expect(page.locator('#notice')).toContainText('Session ended.'); await expect(page.getByRole('button', { name: 'Refresh sessions', exact: true })).toBeFocused(); assert.equal(mutations, 1); assert.equal((await api('/session', peers[0])).status, 401)

  let release, entered; const held = new Promise(done => { entered = done }), gate = new Promise(done => { release = done }); gates.push(release)
  await page.route('**/account/sessions?*', async route => { const response = await route.fetch(); entered(); await gate; try { await route.fulfill({ response }) } catch {} })
  await page.getByRole('button', { name: 'Refresh sessions', exact: true }).click(); await held; await expect(page.locator('.session-inventory')).toHaveAttribute('aria-busy', 'true'); await expect(page.locator('.session-row')).toHaveCount(0); await capture(page, 'loading')
  await page.getByRole('link', { name: 'Commands', exact: true }).click(); await ready(page); release(); await page.unroute('**/account/sessions?*'); await expect(page.getByRole('heading', { name: 'Your commands', exact: true })).toBeVisible(); await expect(page.locator('.session-row')).toHaveCount(0)
  await account(page); await loaded(page)
  await owner.execute('REVOKE SELECT ON longhorn_auth.sessions FROM longhorn_app'); await owner.execute('GRANT SELECT(token_hash,user_id,expires_at) ON longhorn_auth.sessions TO longhorn_app')
  try { await page.getByRole('button', { name: 'Refresh sessions', exact: true }).click(); await expect(page.getByText('Could not load sessions. Refresh to try again.', { exact: true })).toBeVisible(); await expect(page.locator('.session-row')).toHaveCount(0); await capture(page, 'permission-error') } finally { await owner.execute('GRANT SELECT ON longhorn_auth.sessions TO longhorn_app') }
  await page.getByRole('button', { name: 'Refresh sessions', exact: true }).click(); await loaded(page)
  for (const theme of ['light', 'dark']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Use dark theme' : 'Use light theme' }).click()
    await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => { document.documentElement.style.fontSize = '130%' }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); const file = resolve(output, 'scaled-' + theme + '.png'); await page.screenshot({ path: file, fullPage: true }); captures.push(file)
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze(); violations.push(...result.violations.map(row => ({ name: 'scaled', theme, width: 390, id: row.id }))); await page.evaluate(() => { document.documentElement.style.fontSize = '' })
  }
  await page.setViewportSize({ width: 1360, height: 960 })
  let lostCommit = false
  await page.route('**/account/sessions/end', async route => { const response = await route.fetch(); const result = await response.json(); lostCommit = response.status() === 200 && result.revokedSessions === 1; await route.abort('failed') })
  let selected = page.locator('.session-row').nth(1); await selected.getByRole('button', { name: 'End session 2', exact: true }).click(); await selected.getByRole('button', { name: 'End session', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sign in to LongHorn', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled(); assert.equal(lostCommit, true); assert.equal((await api('/session', peers[1])).status, 401); await page.unroute('**/account/sessions/end'); await capture(page, 'uncertain-change')
  const signBackIn = async () => { await page.getByLabel('Username', { exact: true }).fill('session.member'); await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Your commands', exact: true })).toBeVisible(); currentCookie = (await context.cookies(origin)).find(row => row.name === 'longhorn_dev'); cookie = currentCookie.name + '=' + currentCookie.value; await account(page); await loaded(page) }
  await signBackIn()
  const memberId = (await (await api('/session', cookie)).json()).user.id, ownerRows = async () => (await owner.execute({ sql: 'SELECT session_id FROM longhorn_auth.sessions WHERE user_id=$1 ORDER BY session_id', args: [memberId] })).rows
  const unchanged = await ownerRows(); await context.addCookies([{ name: currentCookie.name, value: foreignCookie.split('=')[1], url: origin, httpOnly: true, sameSite: 'Strict' }])
  selected = page.locator('.session-row').nth(1); await selected.getByRole('button', { name: 'End session 2', exact: true }).click(); await selected.getByRole('button', { name: 'End session', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sign in to LongHorn', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled(); await expect(page.locator('#notice')).toContainText('Your active account changed.'); assert.deepEqual(await ownerRows(), unchanged); assert.equal((await api('/session', foreignCookie)).status, 200); await capture(page, 'viewer-changed')
  await signBackIn(); assert.equal((await api('/session', peers[2])).status, 200)
  await page.getByRole('button', { name: 'End other sessions', exact: true }).click(); await expect(page.locator('.session-row')).toHaveCount(1); await loaded(page); await expect(page.getByText('This session', { exact: true })).toBeVisible(); assert.equal((await api('/session', peers[2])).status, 401)
  assert.equal((await api('/session', cookie)).status, 200)
  const currentRow = page.locator('.session-row').filter({ has: page.getByText('This session', { exact: true }) }); await currentRow.getByRole('button', { name: 'End session in this browser', exact: true }).click(); await currentRow.getByRole('button', { name: 'End session', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sign in to LongHorn', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled(); await expect(page.locator('.session-row')).toHaveCount(0); assert.equal((await api('/session', cookie)).status, 401); assert.equal((await api('/session', peers[2])).status, 401)
  const futureLogin = await api('/login', undefined, { username: 'session.member', password }); assert.equal(futureLogin.status, 200); const futureCookie = futureLogin.headers.get('set-cookie').split(';')[0]
  let releaseLock, locking, locked = false, pid
  const nativeGate = new Promise(done => { releaseLock = done }); gates.push(releaseLock)
  locking = owner.transaction(async tx => { pid = (await tx.execute('SELECT pg_backend_pid() AS pid')).rows[0].pid; await tx.execute({ sql: 'SELECT pg_advisory_xact_lock(hashtextextended($1,0))', args: ['longhorn:auth-password:' + memberId] }); locked = true; await nativeGate })
  while (!locked) await new Promise(done => setTimeout(done, 2))
  const pending = api('/sessions', futureCookie), deadline = Date.now() + 10000
  while (!(await owner.execute({ sql: 'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::integer=ANY(pg_blocking_pids(pid))) AS waiting', args: [pid] })).rows[0].waiting) { assert.ok(Date.now() < deadline); await new Promise(done => setTimeout(done, 2)) }
  let closed = false; const closing = applications[0].close().then(() => { closed = true }); await new Promise(done => setTimeout(done, 25)); assert.equal(closed, false); assert.equal(pools[0].stats().closed, false)
  releaseLock(); await locking; assert.equal((await pending).status, 200); await closing; assert.equal(pools[0].stats().closed, true)
  assert.deepEqual(errors, []); assert.deepEqual(violations, [])
  await writeFile(resolve(output, 'accessibility.json'), JSON.stringify({ captures, violations, errors }, null, 2) + '\n')
  await writeFile('.artifacts/session-inventory-console-proof.json', JSON.stringify({ realScryptAndPostgres: true, httpCloseDrainsNative: true, futureLoginAllowed: true, publicApiPrivateAndScoped: true, disabledCapability: true, nativePermissionFailureRecovery: true, currentMarker: true, manualPagination: true, selectedRevocation: true, droppedCommittedReplyRequiresSignIn: true, cookieSwitchedAccountRefused: true, bulkControlRefresh: true, singleSubmission: true, keyboardCancelAndFocus: true, staleNavigationFenced: true, currentRevocationSignInEnabled: true, reducedMotion: true, scaledText: 1.3, captures: captures.length, axeViolations: 0, realDeviceAssistiveTechnology: false }, null, 2) + '\n')
  console.log('Session inventory browser: actual Scrypt/SQL/API, scoped private pages, selected/current revocation, focus/navigation/permission recovery and ' + captures.length + ' accessible light/dark/phone captures pass.')
} finally { for (const release of gates) release(); await browser?.close(); for (const application of applications.reverse()) await application.close(); await owner?.close(); await sandbox?.stop() }
