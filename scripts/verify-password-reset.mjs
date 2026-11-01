// Password reset against real SQLite and real PostgreSQL, as a restricted runtime role, under real concurrency.
import assert from 'node:assert/strict'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService,PasswordResetError,PasswordResets } from '../packages/auth/dist/index.js'
import { authMigrations,SqliteAuthStore,SqlitePasswordResetStore,sqlitePasswordResetMigrations } from '../packages/auth/dist/sqlite.js'
import { checkPostgresPasswordResetFunctions,PostgresAuthStore,postgresAuthMigrations,postgresAuthTransactionMigrations,PostgresPasswordResetStore,postgresPasswordResetFunctions,postgresPasswordResetMigrations } from '../packages/auth/dist/postgres.js'
import { postgresPasswordFunctions,postgresPasswordMigrations } from '../packages/auth/dist/postgres-passwords.js'
import { migrate } from '../packages/database/dist/index.js'
import { migratePostgres } from '../packages/database/dist/postgres.js'
import { openSqlite } from '../runtimes/node/dist/sqlite.js'
import { openPostgres } from '../runtimes/node/dist/postgres.js'
import { startPostgresCluster } from './postgres-cluster.mjs'

const current='a fixture current passphrase',next='a different fixture passphrase'
const passwords={hash:async value=>'fixture:'+value,verify:async(value,encoded)=>encoded==='fixture:'+value}
const outcomes=results=>results.map(result=>result.status==='fulfilled'?'ok':result.reason instanceof PasswordResetError?'rejected':String(result.reason))
async function exercise(label,store,resets,sent){
  const auth=new AuthService(store,passwords,{passwordChanges:true,sessionControls:false})
  await auth.register(label+'-a',current)
  const session=(await auth.login(label+'-a',current)).session
  await resets.request(label+'-a')
  const{token}=sent.at(-1),results=outcomes(await Promise.allSettled(Array.from({length:8},(_,i)=>resets.confirm(token,next+i))))
  assert.equal(results.filter(result=>result==='ok').length,1,String(results));assert.equal(results.filter(result=>result==='rejected').length,7,String(results))
  const winner=await (async()=>{for(let i=0;i<8;i++)if(results[i]==='ok')return next+i})()
  assert.equal(await auth.authenticate(session.token),undefined)
  assert.equal((await auth.login(label+'-a',winner)).user.username,label+'-a')
  await assert.rejects(auth.login(label+'-a',current),{code:'INVALID_CREDENTIALS'})
  console.log(label+': eight concurrent confirms of one token gave exactly one replacement, every session was revoked and the old password stopped working.')

  // A login that verified the old password before the reset must not get a session after it.
  await auth.register(label+'-b',current)
  let release,reached;const verified=new Promise(resolve=>{reached=resolve}),gate=new Promise(resolve=>{release=resolve})
  const slow=new AuthService(store,{hash:passwords.hash,verify:async(value,encoded)=>{const valid=await passwords.verify(value,encoded);reached();await gate;return valid}},{})
  const login=slow.login(label+'-b',current).then(()=>'issued',error=>error.code)
  await verified;await resets.request(label+'-b');await resets.confirm(sent.at(-1).token,next);release()
  assert.equal(await login,'INVALID_CREDENTIALS')
  console.log(label+': a login that verified the old password before the reset was refused a session afterwards.')

  // A session created just before the reset cannot survive it, whichever commits first.
  await auth.register(label+'-c',current);await resets.request(label+'-c')
  const race=await Promise.allSettled([auth.login(label+'-c',current),resets.confirm(sent.at(-1).token,next)])
  assert.equal(race[1].status,'fulfilled')
  if(race[0].status==='fulfilled')assert.equal(await auth.authenticate(race[0].value.session.token),undefined)
  console.log(label+': a login racing the reset never leaves a live session behind.')

  // Changing the password the normal way kills an outstanding token.
  await auth.register(label+'-d',current);const held=(await auth.login(label+'-d',current)).session
  await resets.request(label+'-d');const stale=sent.at(-1).token
  await auth.changePassword(held.token,current,next)
  await assert.rejects(resets.confirm(stale,'yet another fixture passphrase'),PasswordResetError)
  assert.equal((await auth.login(label+'-d',next)).user.username,label+'-d')
  console.log(label+': a password changed after issue kills the outstanding token.')
}
const temporary=await mkdtemp(join(tmpdir(),'longhorn-password-reset-'));let cluster,owner,runtime,sqlite
try{
  sqlite=await openSqlite({filename:join(temporary,'auth.sqlite')});await migrate(sqlite,[...authMigrations,...sqlitePasswordResetMigrations])
  const sent=[],store=new SqliteAuthStore(sqlite)
  await exercise('sqlite',store,new PasswordResets(store,new SqlitePasswordResetStore(sqlite),passwords,{deliver:delivery=>{sent.push(delivery)}}),sent)

  cluster=await startPostgresCluster();owner=await openPostgres({connectionString:cluster.connectionString,maxConnections:2})
  await migratePostgres(owner,[...postgresAuthMigrations,...postgresAuthTransactionMigrations,...postgresPasswordMigrations,...postgresPasswordResetMigrations])
  const secret='runtime-gate-only';await owner.execute(`CREATE ROLE reset_runtime LOGIN PASSWORD '${secret}'`)
  for(const statement of['GRANT USAGE ON SCHEMA longhorn_auth TO reset_runtime','GRANT SELECT,INSERT ON longhorn_auth.users TO reset_runtime','GRANT SELECT,INSERT,DELETE ON longhorn_auth.sessions TO reset_runtime','GRANT SELECT,INSERT,UPDATE,DELETE ON longhorn_auth.attempts TO reset_runtime',
    'GRANT EXECUTE ON FUNCTION longhorn_auth.lock_session_user(text) TO reset_runtime',...[...postgresPasswordFunctions,...postgresPasswordResetFunctions].map(signature=>`GRANT EXECUTE ON FUNCTION ${signature} TO reset_runtime`)])await owner.execute(statement)
  const url=new URL(cluster.connectionString);url.username='reset_runtime';url.password=secret
  runtime=await openPostgres({connectionString:url.href,maxConnections:12})
  await checkPostgresPasswordResetFunctions(runtime)
  await assert.rejects(runtime.execute('SELECT * FROM longhorn_auth.password_resets'),/permission denied/)
  await assert.rejects(runtime.execute("UPDATE longhorn_auth.users SET password_hash='x'"),/permission denied/)
  for(const signature of postgresPasswordResetFunctions){
    const row=(await owner.execute({sql:`SELECT p.prosecdef,p.proconfig::text AS config,pg_catalog.has_function_privilege('public',p.oid,'EXECUTE') AS public_execute FROM pg_catalog.pg_proc p WHERE p.oid=$1::regprocedure`,args:[signature]})).rows[0]
    assert.equal(row.prosecdef,true);assert.match(row.config,/search_path=pg_catalog, pg_temp/);assert.equal(row.public_execute,false)
  }
  console.log('postgres: the runtime role cannot read reset tokens or update passwords directly, and each function is hardened and not public.')
  const pgSent=[],pgStore=new PostgresAuthStore(runtime),reset=new PostgresPasswordResetStore(runtime)
  await exercise('postgres',pgStore,new PasswordResets(pgStore,reset,passwords,{deliver:delivery=>{pgSent.push(delivery)}}),pgSent)
  const stale=new PasswordResets(pgStore,reset,passwords,{deliver:delivery=>{pgSent.push(delivery)},clock:()=>0,ttlMs:60000})
  await new AuthService(pgStore,passwords).register('postgres-e',current);await stale.request('postgres-e')
  await assert.rejects(new PasswordResets(pgStore,reset,passwords,{deliver(){}}).confirm(pgSent.at(-1).token,next),PasswordResetError)
  assert.equal((await owner.execute("SELECT count(*)::int AS n FROM longhorn_auth.password_resets r JOIN longhorn_auth.users u ON u.id=r.user_id WHERE u.username='postgres-e'")).rows[0].n,0)
  await stale.request('postgres-e');assert.equal(await new PasswordResets(pgStore,reset,passwords,{deliver(){}}).prune(),1)
  console.log('postgres: an expired token is refused and spent, and prune removes expired tokens.')
}finally{
  await runtime?.close();await owner?.close();await sqlite?.close();await cluster?.stop();await rm(temporary,{recursive:true,force:true})
}
