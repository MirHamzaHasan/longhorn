import { afterEach,beforeEach,expect,it } from 'vitest'
import type { Longhorn } from '@longhornjs/core'
import { openPostgres } from '@longhornjs/node/postgres'
import { createPostgresApp } from './app.js'
if (process.env.LONGHORN_PG_TEST_OWNED!=='true' || !process.env.LONGHORN_PG_TEST_URL || !process.env.LONGHORN_PG_APP_URL) throw new Error('Use pnpm test:postgres with the owned database')
const apps: Longhorn[]=[]
const origin='http://127.0.0.1:3003',password='a native account test passphrase'
// Fast HTTP/storage fixture. The executable's actual scrypt is verified by separate-process checks.
const passwords={ hash: async (value: string) => 'qa:'+value,verify: async (value: string,hash: string | undefined) => hash==='qa:'+value }
beforeEach(async () => {
  const owner=await openPostgres({ connectionString: process.env.LONGHORN_PG_TEST_URL! })
  try { await owner.execute('TRUNCATE longhorn_auth.users,longhorn_auth.sessions,longhorn_auth.attempts,longhorn_pg_example.private_notes RESTART IDENTITY') }
  finally { await owner.close() }
})
afterEach(async () => { for (const app of apps.splice(0).reverse()) await app.close() })
function setup(options: { clock?: () => number;secure?: boolean;origin?: string;ttl?: number }={}) {
  const app=createPostgresApp({ openDatabase: () => openPostgres({ connectionString: process.env.LONGHORN_PG_APP_URL! }),accounts: {
    origin: options.origin ?? origin,secure: options.secure ?? false,sessionTtlMs: options.ttl ?? 28800000,passwords,...(options.clock ? { clock: options.clock } : {}),
  } });apps.push(app)
  const request=(path: string,method='GET',body?: unknown,cookie?: string,from=options.origin ?? origin) => app.fetch(new Request((options.origin ?? origin)+path,{
    method,headers: { 'Content-Type': 'application/json',Origin: from,...(cookie ? { Cookie: cookie } : {}) },...(body===undefined ? {} : { body: JSON.stringify(body) }),
  }))
  async function register(username: string) { const result=await request('/account/register','POST',{ username,password });expect(result.status).toBe(201);return (await result.json()).user }
  async function login(username: string,previous?: string) {
    const result=await request('/account/login','POST',{ username,password },previous);expect(result.status).toBe(200)
    return { cookie: result.headers.getSetCookie().at(-1)!.split(';')[0]!,response: result,body: await result.json() }
  }
  return { app,request,register,login }
}
it('keeps cookie auth scoped to account routes and enforces private ownership in every note query',async () => {
  const { app,request,register,login }=setup()
  expect((await app.fetch(new Request(origin+'/tasks',{ method: 'POST',headers: { 'Content-Type': 'application/json' },body: '{"title":"public remains usable"}' }))).status).toBe(201)
  expect((await request('/account/notes')).status).toBe(401)
  expect((await request('/account/register','POST',{ username: 'alice',password },undefined,'https://other.example')).status).toBe(403)
  expect((await request('/account/register','POST',{ username: 'alice',password,roles: ['admin'] })).status).toBe(400)
  await register('alice');await register('bob')
  const alice=await login('alice'),bob=await login('bob')
  const notes=[]
  for (const title of ['one','two',"x'); DELETE FROM private_notes; --"]) {
    const response=await request('/account/notes','POST',{ title },alice.cookie);expect(response.status).toBe(201)
    const { note }=await response.json();notes.push(note);expect(response.headers.get('Location')).toBe('/account/notes/'+note.id)
  }
  const page=await(await request('/account/notes?limit=2','GET',undefined,alice.cookie)).json()
  expect(page.notes).toEqual(notes.slice(0,2));expect(page.nextCursor).toBe(notes[1].id)
  const next=await(await request('/account/notes?after='+page.nextCursor,'GET',undefined,alice.cookie)).json()
  expect(next.notes).toEqual([notes[2]]);expect(next.nextCursor).toBeNull()
  expect((await(await request('/account/notes','GET',undefined,bob.cookie)).json()).notes).toEqual([])
  for (const method of ['GET','DELETE']) expect((await request('/account/notes/'+notes[0].id,method,undefined,bob.cookie)).status).toBe(404)
  expect((await request('/account/notes/9223372036854775808','GET',undefined,alice.cookie)).status).toBe(400)
  expect((await request('/account/notes?limit=101','GET',undefined,alice.cookie)).status).toBe(400)
  expect((await request('/account/notes','POST',{ title: 'bad',owner_id: 'bob' },alice.cookie)).status).toBe(400)
  expect((await request('/account/notes/'+notes[0].id,'DELETE',undefined,alice.cookie)).status).toBe(204)
})
it('shares current roles, session rotation and all-device revocation across application instances',async () => {
  const a=setup(),b=setup(),user=await a.register('alice');await a.register('bob')
  const old=await a.login('alice'),rotated=await b.login('alice',old.cookie),device=await a.login('alice'),bob=await b.login('bob')
  expect((await a.request('/account/session','GET',undefined,old.cookie)).status).toBe(401)
  expect((await b.request('/account/admin','GET',undefined,device.cookie)).status).toBe(403)
  const owner=await openPostgres({ connectionString: process.env.LONGHORN_PG_TEST_URL! })
  try { await owner.execute({ sql: 'UPDATE longhorn_auth.users SET roles=$1::jsonb WHERE id=$2',args: ['["admin"]',user.id] }) }
  finally { await owner.close() }
  expect((await b.request('/account/admin','GET',undefined,device.cookie)).status).toBe(200)
  expect((await a.request('/account/logout','POST',undefined,rotated.cookie)).status).toBe(204)
  expect((await b.request('/account/session','GET',undefined,rotated.cookie)).status).toBe(401)
  expect((await b.request('/account/logout-all','POST',undefined,device.cookie)).status).toBe(204)
  expect((await a.request('/account/session','GET',undefined,device.cookie)).status).toBe(401)
  expect((await a.request('/account/session','GET',undefined,bob.cookie)).status).toBe(200)
})
it('preserves secure cookie flags, generic credential errors and secret-free public principals',async () => {
  const { request,register,login }=setup({ origin: 'https://accounts.example',secure: true })
  await register('alice')
  const wrong=await request('/account/login','POST',{ username: 'alice',password: 'wrong' }),unknown=await request('/account/login','POST',{ username: 'unknown',password: 'wrong' })
  expect(wrong.status).toBe(401);expect(await wrong.json()).toEqual(await unknown.json())
  const logged=await login('alice'),cookie=logged.response.headers.getSetCookie().at(-1)!
  expect(cookie).toContain('__Host-id=');expect(cookie).toContain('Secure');expect(cookie).toContain('HttpOnly');expect(cookie).toContain('SameSite=Strict');expect(cookie).toContain('Path=/')
  expect(logged.body.user).not.toHaveProperty('passwordHash');expect(logged.body.session).not.toHaveProperty('token')
  const token=logged.cookie.split('=')[1]!
  const response=await request('/account/session','GET',undefined,logged.cookie)
  expect(response.headers.get('Cache-Control')).toBe('no-store');expect(response.headers.get('Vary')).toContain('Cookie')
  expect(JSON.stringify(await response.json())).not.toContain(token)
  expect((await request('/account/session','GET',undefined,logged.cookie+'; '+logged.cookie)).status).toBe(401)
})
it('shares throttle windows and exact session expiry across instances',async () => {
  let now=1000
  const a=setup({ clock: () => now,ttl: 1000 }),b=setup({ clock: () => now,ttl: 1000 })
  await a.register('alice');const logged=await a.login('alice');now=2000
  expect((await b.request('/account/session','GET',undefined,logged.cookie)).status).toBe(401)
  for (let index=0;index<10;index++) expect((await (index%2 ? a : b).request('/account/login','POST',{ username: 'limited',password: 'wrong' })).status).toBe(401)
  const blocked=await b.request('/account/login','POST',{ username: 'LIMITED',password });expect(blocked.status).toBe(429);expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0)
  now+=900000
  expect((await a.request('/account/login','POST',{ username: 'limited',password: 'wrong' })).status).toBe(401)
})
it('validates account configuration during startup and releases an acquired pool on failure',async () => {
  const database=await openPostgres({ connectionString: process.env.LONGHORN_PG_APP_URL! })
  const app=createPostgresApp({ openDatabase: async () => database,accounts: { origin,secure: false,sessionTtlMs: 0,passwords } });apps.push(app)
  await expect(app.start()).rejects.toThrow('Session lifetime')
  expect(database.stats().closed).toBe(true)
})
