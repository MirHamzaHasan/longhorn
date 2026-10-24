import type { Database,SqlValue } from '@longhorn/database'
import type { RateLimitReservation,RateLimitStore,StoredRateLimit } from './types.js'
import { bounded,clock,RateLimitError,reservation } from './protocol.js'
function integer(value:SqlValue|undefined):number{const n=typeof value==='bigint'?Number(value):value;if(typeof n!=='number'||!Number.isSafeInteger(n))throw new RateLimitError('PROTOCOL');return n}
/** Native ownership is taken before clock sampling and retained through commit. */
export class SqlRateLimitStore implements RateLimitStore {
  constructor(private readonly database:Database,private readonly dialect:'sqlite'|'postgres'){
    if(database.dialect!==dialect)throw new Error('Request limit store requires its matching SQL provider')
  }
  async consume(input:RateLimitReservation,now:()=>number):Promise<StoredRateLimit>{
    const request=reservation(input),pg=this.dialect==='postgres',table=pg?'longhorn_rate_limit.buckets':'longhorn_rate_limit_buckets'
    return this.database.transaction(async tx=>{
      const claim=crypto.randomUUID()
      const row=(await tx.execute({sql:`INSERT INTO ${table}(scope,subject_hash,claim,policy_limit,window_ms,attempts,expires_at)
        VALUES (${pg?'$1,$2,$3,$4,$5':'?,?,?,?,?'},0,NULL)
        ON CONFLICT(scope,subject_hash) DO UPDATE SET scope=excluded.scope
        RETURNING claim,policy_limit,window_ms,attempts,expires_at`,args:[request.scope,request.key,claim,request.limit,request.windowMs]})).rows[0]
      if(!row)throw new RateLimitError('PROTOCOL')
      const time=clock(now);if(!Number.isSafeInteger(time+request.windowMs))throw new RateLimitError('INPUT')
      const previous=integer(row.attempts),previousLimit=integer(row.policy_limit),previousWindow=integer(row.window_ms)
      if(previousLimit<1||previousLimit>1_000_000||previousWindow<1000||previousWindow>86_400_000||previous<0||previous>previousLimit+1||typeof row.claim!=='string'||!row.claim)throw new RateLimitError('PROTOCOL')
      let attempts=1,expires=time+request.windowMs
      if(row.expires_at===null){if(row.claim!==claim||previous!==0)throw new RateLimitError('PROTOCOL')}
      else{
        const priorExpiry=integer(row.expires_at);if(priorExpiry<0||previous<1)throw new RateLimitError('PROTOCOL')
        if(priorExpiry>time){
          if(previousLimit!==request.limit||previousWindow!==request.windowMs)throw new RateLimitError('POLICY_MISMATCH')
          attempts=Math.min(previous+1,request.limit+1);expires=priorExpiry
        }
      }
      const updated=await tx.execute({sql:`UPDATE ${table} SET claim=${pg?'$1':'?'},policy_limit=${pg?'$2':'?'},window_ms=${pg?'$3':'?'},attempts=${pg?'$4':'?'},expires_at=${pg?'$5':'?'} WHERE scope=${pg?'$6':'?'} AND subject_hash=${pg?'$7':'?'}`,
        args:[claim,request.limit,request.windowMs,attempts,expires,request.scope,request.key]})
      if(updated.rowsAffected!==1)throw new RateLimitError('PROTOCOL')
      return{allowed:attempts<=request.limit,remaining:Math.max(0,request.limit-attempts),resetsAt:expires}
    })
  }
  async prune(input:{readonly now:number;readonly limit:number}):Promise<number>{
    const now=bounded(input.now,Number.MAX_SAFE_INTEGER,0),limit=bounded(input.limit,10_000)
    const sql=this.dialect==='postgres'?`WITH expired AS (
      SELECT scope,subject_hash FROM longhorn_rate_limit.buckets WHERE expires_at<=$1 ORDER BY expires_at,scope,subject_hash LIMIT $2 FOR UPDATE SKIP LOCKED
    ) DELETE FROM longhorn_rate_limit.buckets AS buckets USING expired WHERE buckets.scope=expired.scope AND buckets.subject_hash=expired.subject_hash`:
      `DELETE FROM longhorn_rate_limit_buckets WHERE (scope,subject_hash) IN (SELECT scope,subject_hash FROM longhorn_rate_limit_buckets WHERE expires_at<=? ORDER BY expires_at,scope,subject_hash LIMIT ?)`
    return(await this.database.execute({sql,args:[now,limit]})).rowsAffected
  }
}
