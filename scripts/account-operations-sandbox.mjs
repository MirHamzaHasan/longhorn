import { startPostgresSandbox } from './postgres-sandbox.mjs'
import { openPostgres } from '../runtimes/node/dist/postgres.js'
import { migratePostgres } from '../packages/database/dist/postgres.js'
import { postgresOperationsMigrations } from '../examples/postgres/dist/operations-migrations.js'
import { postgresPasswordFunctions } from '../packages/auth/dist/postgres-passwords.js'
/** Owns the normal native sandbox and appends the explicit operations deployment profile. */
export async function startAccountOperationsSandbox(){
  const sandbox=await startPostgresSandbox();let owner
  try{
    owner=await openPostgres({connectionString:sandbox.ownerUrl})
    await migratePostgres(owner,postgresOperationsMigrations,{schema:'longhorn_pg_example'})
    await owner.execute('GRANT EXECUTE ON FUNCTION longhorn_auth.lock_session_user(text) TO longhorn_app')
    for(const signature of postgresPasswordFunctions)await owner.execute('GRANT EXECUTE ON FUNCTION '+signature+' TO longhorn_app')
    await owner.execute('GRANT SELECT,INSERT ON longhorn_pg_example.operator_commands TO longhorn_app')
    await owner.execute('GRANT SELECT,INSERT,UPDATE,DELETE ON longhorn_pg_example.history_views TO longhorn_app')
    await owner.execute('GRANT USAGE ON SCHEMA longhorn_outbox TO longhorn_app')
    await owner.execute('GRANT SELECT,INSERT ON longhorn_outbox.recovery_audit TO longhorn_app')
    return sandbox
  }catch(error){await sandbox.stop();throw error}finally{await owner?.close()}
}
