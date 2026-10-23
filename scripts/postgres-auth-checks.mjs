import assert from 'node:assert/strict'
import { PostgresAuthStore } from '../packages/auth/dist/postgres.js'

/** Real compiled hosts and native scrypt. URLs/tokens stay inside this owned harness. */
export async function verifyPostgresAccounts({ host,owner,fixture,record,completed,stop }) {
  await owner.execute('TRUNCATE longhorn_auth.users,longhorn_auth.sessions,longhorn_auth.attempts,longhorn_pg_example.private_notes RESTART IDENTITY')
  const origin='http://127.0.0.1:3003',password='a long native PostgreSQL test passphrase'
  const tokens=[],instances=[],hashes=[]
  const launch=async (environment={}) => { const current=await host({ AUTH_ORIGIN: origin,AUTH_COOKIE_SECURE: 'false',SESSION_TTL_SECONDS: '28800',...environment });instances.push(current.instance);return current }
  const request=(url,path,{ method='GET',body,cookie,from=origin }={}) => fetch(url+path,{
    method,headers: { Origin: from,'Content-Type': 'application/json',...(cookie ? { Cookie: cookie } : {}) },
    ...(body===undefined ? {} : { body: JSON.stringify(body) }),signal: AbortSignal.timeout(15000),
  })
  async function login(url,username,previous) {
    const response=await request(url,'/account/login',{ method: 'POST',body: { username,password },cookie: previous })
    assert.equal(response.status,200)
    const cookie=response.headers.getSetCookie().at(-1)
    assert.ok(cookie.startsWith('longhorn_dev=') && cookie.includes('HttpOnly') && cookie.includes('SameSite=Strict') && cookie.includes('Path=/'))
    const value=cookie.split(';')[0];tokens.push(value.split('=')[1])
    const result=await response.json();assert.deepEqual(Object.keys(result.session),['expiresAt']);assert.ok(!JSON.stringify(result).includes('passwordHash'))
    return { cookie: value,...result }
  }
  try {
    let a=await launch();const b=await launch()
    assert.equal((await request(a.url,'/account/notes')).status,401)
    assert.equal((await request(a.url,'/account/register',{ method: 'POST',body: { username: 'alice',password },from: 'https://attacker.example' })).status,403)
    assert.equal((await request(a.url,'/account/register',{ method: 'POST',body: { username: 'alice',password,roles: ['admin'] } })).status,400)
    for (const username of ['alice','bob']) assert.equal((await request(a.url,'/account/register',{ method: 'POST',body: { username,password } })).status,201)
    const duplicates=await Promise.all([a,b].map(current => request(current.url,'/account/register',{ method: 'POST',body: { username: 'duplicate',password } })))
    assert.deepEqual(duplicates.map(response => response.status).sort(),[201,409])
    const wrong=await request(a.url,'/account/login',{ method: 'POST',body: { username: 'alice',password: 'wrong' } }),unknown=await request(b.url,'/account/login',{ method: 'POST',body: { username: 'missing',password: 'wrong' } })
    assert.equal(wrong.status,401);assert.equal(unknown.status,401);assert.deepEqual(await wrong.json(),await unknown.json())
    const alice=await login(a.url,'ALICE'),bob=await login(b.url,'bob')
    const created=await request(a.url,'/account/notes',{ method: 'POST',cookie: alice.cookie,body: { title: 'durable PostgreSQL private note' } })
    assert.equal(created.status,201);const { note }=await created.json()
    assert.deepEqual((await(await request(b.url,'/account/notes',{ cookie: bob.cookie })).json()).notes,[])
    for (const method of ['GET','DELETE']) assert.equal((await request(b.url,'/account/notes/'+note.id,{ method,cookie: bob.cookie })).status,404)
    assert.equal((await request(b.url,'/account/session',{ cookie: alice.cookie })).status,200)
    hashes.push(...(await owner.execute('SELECT password_hash FROM longhorn_auth.users')).rows.map(row => row.password_hash))
    assert.equal(hashes.length,3);assert.equal(new Set(hashes).size,3)
    assert.ok(hashes.every(hash => /^scrypt\$v=1\$n=131072,r=8,p=1\$/.test(hash)))
    for (const row of (await owner.execute('SELECT token_hash FROM longhorn_auth.sessions')).rows) assert.ok(!tokens.includes(row.token_hash))
    assert.equal((await request(a.url,'/account/admin',{ cookie: alice.cookie })).status,403)
    await owner.execute({ sql: 'UPDATE longhorn_auth.users SET roles=$1::jsonb WHERE id=$2',args: ['["admin"]',alice.user.id] })
    assert.equal((await request(b.url,'/account/admin',{ cookie: alice.cookie })).status,200)
    await owner.execute({ sql: 'UPDATE longhorn_auth.users SET roles=$1::jsonb WHERE id=$2',args: ['["member"]',alice.user.id] })
    assert.equal((await request(a.url,'/account/admin',{ cookie: alice.cookie })).status,403)
    const rotated=await login(b.url,'alice',alice.cookie),device=await login(a.url,'alice')
    assert.equal((await request(a.url,'/account/session',{ cookie: alice.cookie })).status,401)
    assert.equal((await request(a.url,'/account/logout',{ method: 'POST',cookie: rotated.cookie })).status,204)
    assert.equal((await request(b.url,'/account/session',{ cookie: rotated.cookie })).status,401)
    await stop(a.instance);a=await launch()
    assert.deepEqual((await(await request(a.url,'/account/notes',{ cookie: device.cookie })).json()).notes,[note])
    const extra=await login(a.url,'alice')
    assert.equal((await request(b.url,'/account/logout-all',{ method: 'POST',cookie: device.cookie })).status,204)
    for (const cookie of [device.cookie,extra.cookie]) assert.equal((await request(a.url,'/account/session',{ cookie })).status,401)
    assert.equal((await request(b.url,'/account/session',{ cookie: bob.cookie })).status,200)
    const shortHost=await launch({ SESSION_TTL_SECONDS: '1' }),short=await login(shortHost.url,'bob')
    assert.equal((await request(shortHost.url,'/account/session',{ cookie: short.cookie })).status,200)
    await new Promise(resolve => setTimeout(resolve,Math.max(0,short.session.expiresAt-Date.now()+20)))
    const expired=await request(shortHost.url,'/account/session',{ cookie: short.cookie });assert.equal(expired.status,401);assert.equal(expired.headers.get('Cache-Control'),'no-store')
    await stop(shortHost.instance)
    for (let index=0;index<10;index++) assert.equal((await request(index%2 ? a.url : b.url,'/account/login',{ method: 'POST',body: { username: 'limited',password: 'wrong' } })).status,401)
    assert.equal((await request(b.url,'/account/login',{ method: 'POST',body: { username: 'LIMITED',password } })).status,429)
    await stop(a.instance);a=await launch()
    const blocked=await request(a.url,'/account/login',{ method: 'POST',body: { username: 'limited',password } });assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get('Retry-After'))>0)
    await stop(a.instance);await stop(b.instance)
    for (const instance of instances) {
      assert.ok(!instance.output().includes(password),'Password leaked to logs')
      for (const secret of [...tokens,...hashes]) assert.ok(!instance.output().includes(secret),'Session/credential material leaked to logs')
    }
    console.log('PostgreSQL accounts: native scrypt, concurrent registration, cookie/origin guards, private ownership, live roles, session rotation/revocation/expiry, shared throttle and HTTP restart verified without secret logs.')
    const attempts=[fixture('attempts'),fixture('attempts')]
    await Promise.all(attempts.map(instance => record(instance,value => value.ready)))
    for (const instance of attempts) instance.child.stdin.end('go\n')
    const results=(await Promise.all(attempts.map(instance => completed(instance)))).flat()
    assert.equal(results.reduce((sum,value) => sum+(value.allowed ?? 0),0),3)
    assert.equal(results.reduce((sum,value) => sum+(value.blocked ?? 0),0),17)
    const store=new PostgresAuthStore(owner),user={ id: crypto.randomUUID(),username: 'rotation-fixture',roles: ['member'],passwordHash: 'test-fixture-only' }
    await store.createUser(user);await store.createSession({ tokenHash: 'd'.repeat(64),userId: user.id,expiresAt: Date.now()+60000 })
    const crashed=fixture('rotation-crash',{ LONGHORN_PG_AUTH_USER: user.id })
    await record(crashed,value => value.rotationPaused);crashed.child.kill('SIGKILL');await completed(crashed,true)
    assert.ok(await store.findSession('d'.repeat(64)));assert.equal(await store.findSession('e'.repeat(64)),undefined)
    await store.createSession({ tokenHash: 'e'.repeat(64),userId: user.id,expiresAt: Date.now()+60000 },'d'.repeat(64))
    assert.equal(await store.findSession('d'.repeat(64)),undefined);assert.ok(await store.findSession('e'.repeat(64)))
    console.log('PostgreSQL auth atomicity: separate reservation processes admit exactly the shared limit; SIGKILL after session replacement writes rolls back both records and permits later rotation.')
  } finally { await Promise.all(instances.map(instance => stop(instance))) }
}
