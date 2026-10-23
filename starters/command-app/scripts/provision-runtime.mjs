import { openPostgres } from '@longhorn/node/postgres'
import { grantOperatorRuntime } from '../dist/runtime-grants.js'
const [role,...extra]=process.argv.slice(2)
let database
try {
  if(!role||extra.length)throw new Error('Usage: pnpm provision:runtime ROLE')
  if(!process.env.MIGRATION_DATABASE_URL)throw new Error('Missing deployment connection')
  database=await openPostgres({connectionString:process.env.MIGRATION_DATABASE_URL})
  await grantOperatorRuntime(database,role)
  console.log('Runtime grants applied; existing extra privileges were not removed')
}catch{console.error('Runtime provisioning failed; verify role, owner connection and deployed schema');process.exitCode=1}
finally{await database?.close()}
