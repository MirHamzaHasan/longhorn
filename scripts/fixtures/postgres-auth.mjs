import { openPostgres } from '../../runtimes/node/dist/postgres.js'
import { PostgresAuthStore } from '../../packages/auth/dist/postgres.js'
if (process.env.LONGHORN_PG_TEST_OWNED!=='true' || !process.env.LONGHORN_PG_APP_URL) throw new Error('Owned PostgreSQL harness required')
const database=await openPostgres({ connectionString: process.env.LONGHORN_PG_APP_URL })
const emit=value => console.log(JSON.stringify(value))
try {
  if (process.argv[2]==='attempts') {
    emit({ ready: true });await new Promise(resolve => process.stdin.once('data',resolve));process.stdin.pause()
    const store=new PostgresAuthStore(database)
    const results=await Promise.all(Array.from({ length: 10 },() => store.consumeLoginAttempt('native-process-attempts',1000,3,1000)))
    emit({ allowed: results.filter(value => value===undefined).length,blocked: results.filter(value => value===2000).length })
  } else if (process.argv[2]==='rotation-crash') {
    const wrapped={ dialect: 'postgres',execute: input => database.execute(input),close: () => database.close(),
      transaction: work => database.transaction(tx => work({ dialect: 'postgres',async execute(input) {
        const result=await tx.execute(input)
        if ((typeof input==='string' ? input : input.sql).startsWith('DELETE FROM longhorn_auth.sessions')) {
          emit({ rotationPaused: true });setInterval(() => {},1000);await new Promise(() => {})
        }
        return result
      } })) }
    await new PostgresAuthStore(wrapped).createSession({ tokenHash: 'e'.repeat(64),userId: process.env.LONGHORN_PG_AUTH_USER,expiresAt: Date.now()+60000 },'d'.repeat(64))
  } else throw new Error('Unknown PostgreSQL auth fixture mode')
} finally { await database.close() }
