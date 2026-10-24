import { SessionInventory } from '../../packages/auth/dist/session-inventory.js'
import { SessionManager } from '../../packages/auth/dist/index.js'
const tokenHash = async token => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), byte => byte.toString(16).padStart(2, '0')).join('')
const check = (value, text) => { if (!value) throw new Error('Session inventory: ' + text) }
const sleep = ms => new Promise(done => setTimeout(done, ms))
const waitFor = async test => { const end = Date.now() + 10000; while (Date.now() < end) { if (await test()) return; await sleep(2) }; throw new Error('Session inventory condition timed out') }
/** Uses actual native SQL and unchanged legacy session creation. No mock SQL engine. */
export async function inventoryContract({ database, peer, authStore, migrations, inventoryMigrations, migrate, storeFactory, dialect }) {
  const table = dialect === 'postgres' ? 'longhorn_auth.sessions' : 'longhorn_auth_sessions', marker = dialect === 'postgres' ? '$1' : '?'
  let time = 100, samples = 0, release, writing
  const sessions = new SessionManager(authStore, { ttlMs: 10000, clock: () => time }), expired = new SessionManager(authStore, { ttlMs: 1000, clock: () => 0 })
  const owner = { id: 'inventory-owner', username: 'inventory.owner', roles: [], passwordHash: 'unused-native-inventory-hash' }, foreign = { ...owner, id: 'inventory-foreign', username: 'inventory.foreign' }
  await authStore.createUser(owner); await authStore.createUser(foreign)
  const issued = []; for (let i = 0; i < 15; i++) issued.push(await sessions.create(owner.id))
  const outsiders = [await sessions.create(foreign.id), await sessions.create(foreign.id)], old = await expired.create(owner.id)
  const snapshot = async () => (await database.execute('SELECT token_hash,user_id,expires_at FROM ' + table + ' ORDER BY token_hash')).rows
  const before = await snapshot()
  let failed = false
  try { await migrate([...migrations, ...inventoryMigrations, { id: 'inventory_fixture/failed_suffix', statements: ['THIS IS NOT VALID SQL'] }]) } catch { failed = true }
  check(failed, 'failed suffix must reject'); check((await snapshot()).length === before.length, 'failed migration preserved sessions')
  let columnMissing = false; try { await database.execute('SELECT session_id FROM ' + table + ' LIMIT 0') } catch { columnMissing = true }; check(columnMissing, 'failed suffix rolled back column')
  await migrate([...migrations, ...inventoryMigrations]); const after = await snapshot()
  check(after.length === before.length && before.every((row, i) => row.token_hash === after[i].token_hash && row.user_id === after[i].user_id && row.expires_at === after[i].expires_at), 'upgrade preserves legacy credentials/expiry')
  issued.push(await sessions.create(owner.id)) // Native default/trigger also handles a legacy writer after upgrade.
  time = 1100
  const inventory = new SessionInventory(storeFactory(database), { clock: () => { samples++; return time } }), current = issued[0].token
  const pages = []; let cursor
  do { const page = await inventory.list(current, { limit: 4, ...(cursor ? { cursor } : {}) }); pages.push(page); cursor = page.nextCursor } while (cursor)
  const all = pages.flatMap(page => page.sessions)
  check(all.length === issued.length && new Set(all.map(row => row.id)).size === all.length, 'all live owner sessions exactly once')
  check(all.filter(row => row.current).length === 1 && all.every(row => row.expiresAt === 10100), 'current marker and exact expiry')
  const serialized = JSON.stringify(pages)
  for (const candidate of [...issued, ...outsiders, old]) { check(!serialized.includes(candidate.token), 'raw token privacy'); check(!serialized.includes(await tokenHash(candidate.token)), 'token hash privacy') }
  for (const candidate of [issued[1], outsiders[0]]) {
    let rejected = false; try { await inventory.list(candidate.token, { limit: 4, cursor: pages[0].nextCursor }) } catch (error) { rejected = error.code === 'INVALID_INPUT' }; check(rejected, 'cursor bound to owner and initiating session')
  }
  const foreignPage = await inventory.list(outsiders[0].token), foreignId = foreignPage.sessions[0].id
  check((await inventory.revoke(current, foreignId)).revokedSessions === 0, 'no foreign-session oracle or deletion')
  const ownId = (await database.execute({ sql: 'SELECT session_id FROM ' + table + ' WHERE token_hash=' + marker, args: [await tokenHash(issued[1].token)] })).rows[0].session_id
  const problem = new Error('native inventory commit fault')
  const faulted = { dialect: database.dialect, execute: database.execute.bind(database), close: database.close.bind(database), transaction: work => database.transaction(async tx => { const value = await work(tx); throw problem }) }
  let identity = false; try { await new SessionInventory(storeFactory(faulted), { clock: () => time }).revoke(current, ownId) } catch (error) { identity = error === problem; if (!identity) throw new Error('Native deletion failed before injected commit: ' + error.message) }
  check(identity && !!await authStore.findSession(await tokenHash(issued[1].token)), 'delete rolled back with original error')
  check((await inventory.revoke(current, ownId)).revokedSessions === 1, 'selected own session removed'); check((await inventory.revoke(current, ownId)).revokedSessions === 0, 'repeat is a no-op')
  check((await inventory.list(outsiders[0].token)).sessions.length === outsiders.length, 'other owner preserved')
  const left = new SessionInventory(storeFactory(database), { clock: () => time }), right = new SessionInventory(storeFactory(peer), { clock: () => time })
  const leftId = (await left.list(issued[2].token, { limit: 50 })).sessions.find(row => row.current).id, rightId = (await right.list(issued[3].token, { limit: 50 })).sessions.find(row => row.current).id
  const reciprocal = await Promise.allSettled([left.revoke(issued[2].token, rightId), right.revoke(issued[3].token, leftId)])
  check(reciprocal.filter(row => row.status === 'fulfilled' && row.value.revokedSessions === 1).length === 1 && reciprocal.filter(row => row.status === 'rejected' && row.reason.code === 'INVALID_CREDENTIALS').length === 1, 'reciprocal revocation serializes and reauthenticates')
  if (dialect === 'postgres') {
    const isolated = { dialect: database.dialect, execute: database.execute.bind(database), close: database.close.bind(database), transaction: work => database.transaction(async tx => { await tx.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'); return work(tx) }) }
    let rejected = false; try { await new SessionInventory(storeFactory(isolated), { clock: () => time }).list(current) } catch (error) { rejected = error.message.includes('READ COMMITTED') }; check(rejected, 'unsupported isolation rejected')
  }
  let owned = false; const gate = new Promise(done => { release = done })
  try {
    writing = database.transaction(async tx => {
      if (dialect === 'postgres') await tx.execute({ sql: 'SELECT 1 FROM pg_advisory_xact_lock(hashtextextended($1,0))', args: ['longhorn:auth-password:' + owner.id] })
      else await tx.execute('UPDATE ' + table + ' SET expires_at=expires_at')
      owned = true; await gate
    }); await waitFor(() => owned)
    let entered = false
    const observed = { dialect: peer.dialect, execute: peer.execute.bind(peer), close: peer.close.bind(peer), transaction: work => { entered = true; return peer.transaction(work) } }
    const waiting = new SessionInventory(storeFactory(observed), { clock: () => { samples++; return time } }), beforeSamples = samples
    let settled = false; const pending = waiting.list(current).then(() => { throw new Error('Expired initiation was accepted') }, error => { check(error.code === 'INVALID_CREDENTIALS', 'expiry after native ownership'); settled = true })
    await waitFor(() => entered); await sleep(20); check(samples === beforeSamples && !settled, 'clock not sampled before native ownership')
    time = 11000; release(); await writing; writing = undefined; await pending; check(samples === beforeSamples + 1, 'clock sampled once after wait')
  } finally { release?.(); await writing?.catch(() => {}) }
  time = 1100
  const currentEntry = (await inventory.list(current, { limit: 50 })).sessions.find(row => row.current)
  const ended = await inventory.revoke(current, currentEntry.id); check(ended.revokedSessions === 1 && ended.current, 'current-session marker')
  let invalid = false; try { await inventory.list(current) } catch (error) { invalid = error.code === 'INVALID_CREDENTIALS' }; check(invalid, 'revoked initiator rejected')
  check(!!await authStore.findSession(await tokenHash(old.token)), 'expired rows are not implicitly pruned')
  return { legacyUpgrade: true, failedSuffixRollback: true, legacyWriterReference: true, boundedPages: pages.length, ownerLiveSessions: all.length, exactCurrentMarker: true, secretFreePages: true, ownerAndInitiatorCursor: true, foreignPreserved: true, committedSelectedRevocation: true, rollbackIdentity: true, reciprocalOwnership: true, nativeOwnershipClock: true, currentRevocation: true, expiredNotPruned: true }
}
