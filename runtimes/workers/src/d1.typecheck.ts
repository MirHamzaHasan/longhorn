import type { D1Database,D1DatabaseSession } from '@cloudflare/workers-types'
import type { BatchDatabase,Database } from '@longhornjs/database'
import { createD1 } from './d1.js'
function verifyD1Types(binding:D1Database,session:D1DatabaseSession):void{
  const database:BatchDatabase=createD1(binding)
  const fromSession:BatchDatabase=createD1(session)
  void database.batch([{sql:'SELECT ?',args:[1]}])
  // @ts-expect-error A native batch binding cannot supply an interactive callback transaction.
  const interactive:Database=database
  // @ts-expect-error Callback execution is deliberately absent from the D1 handle.
  void database.transaction(async()=>{})
  void fromSession.close()
}
