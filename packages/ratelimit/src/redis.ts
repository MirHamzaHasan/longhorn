import type { RateLimitReservation,ServerTimedRateLimit,ServerTimedRateLimitStore } from './types.js'
import { bounded,RateLimitError,reservation } from './protocol.js'

/** Borrow a command connection; the host retains ownership and closes it after its limiters. */
export interface RedisRateLimitClient { execute(command:readonly string[]):Promise<unknown> }
export type RedisRateLimitOptions={readonly namespace:string;readonly maxConcurrent?:number}
// All reads/validation precede one SET with absolute native expiry. Lua isolation is
// atomic, not rollback: no operation which could fail is issued after the final SET.
const reserve=`local time=redis.call('TIME')
local now=tonumber(time[1])*1000+math.floor(tonumber(time[2])/1000)
local limit=tonumber(ARGV[1])
local window=tonumber(ARGV[2])
if not now or now<0 or now%1~=0 or now>9007199254740991-window then return {3} end
local attempts=1
local expiry=now+window
local value=redis.call('GET',KEYS[1])
if value then
  if #value>128 then return {3} end
  local l,w,a,e=string.match(value,'^v1:(%d+):(%d+):(%d+):(%d+)$')
  if not l or #l>7 or #w>8 or #a>7 or #e>16 then return {3} end
  local oldLimit,oldWindow,oldAttempts,oldExpiry=tonumber(l),tonumber(w),tonumber(a),tonumber(e)
  if oldLimit<1 or oldLimit>1000000 or oldWindow<1000 or oldWindow>86400000 or oldAttempts<1 or oldAttempts>oldLimit+1 or oldExpiry<0 or oldExpiry>9007199254740991 then return {3} end
  if l~=string.format('%.0f',oldLimit) or w~=string.format('%.0f',oldWindow) or a~=string.format('%.0f',oldAttempts) or e~=string.format('%.0f',oldExpiry) then return {3} end
  if redis.call('PEXPIRETIME',KEYS[1])~=oldExpiry then return {3} end
  if oldExpiry>now then
    if oldLimit~=limit or oldWindow~=window then return {2} end
    attempts=math.min(oldAttempts+1,limit+1)
    expiry=oldExpiry
  end
end
local nextValue=string.format('v1:%.0f:%.0f:%.0f:%.0f',limit,window,attempts,expiry)
redis.call('SET',KEYS[1],nextValue,'PXAT',string.format('%.0f',expiry))
local allowed=0
if attempts<=limit then allowed=1 end
return {1,allowed,math.max(0,limit-attempts),expiry,now}`

/** Redis 7+ standalone fixed windows with server-owned time and native key expiry. */
export class RedisRateLimitStore implements ServerTimedRateLimitStore {
  readonly clock='server' as const
  private readonly prefix:string
  private readonly maximum:number
  private active=0
  constructor(private readonly client:RedisRateLimitClient,options:RedisRateLimitOptions){
    if(typeof client?.execute!=='function'||typeof options?.namespace!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(options.namespace))throw new RateLimitError('INPUT')
    this.prefix='longhorn:ratelimit:v1:'+options.namespace+':'
    this.maximum=bounded(options.maxConcurrent??16,1024)
  }
  async consume(input:RateLimitReservation):Promise<ServerTimedRateLimit>{
    const request=reservation(input)
    if(this.active>=this.maximum)throw new RateLimitError('CAPACITY')
    this.active++
    try{
      // Scopes are validated ASCII; base64url avoids colon/glob ambiguity in the key.
      const scope=btoa(request.scope).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
      const result=await this.client.execute(['EVAL',reserve,'1',this.prefix+scope+':'+request.key,String(request.limit),String(request.windowMs)])
      if(Array.isArray(result)&&result.length===1&&result[0]===2)throw new RateLimitError('POLICY_MISMATCH')
      if(!Array.isArray(result)||result.length!==5||result[0]!==1||(result[1]!==0&&result[1]!==1)||!Number.isSafeInteger(result[2])||result[2]<0||result[2]>=request.limit||(result[1]===0&&result[2]!==0)||!Number.isSafeInteger(result[3])||!Number.isSafeInteger(result[4])||result[4]<0||!Number.isSafeInteger(result[4]+request.windowMs)||result[3]<=result[4])throw new RateLimitError('PROTOCOL')
      return Object.freeze({allowed:result[1]===1,remaining:result[2],resetsAt:result[3],observedAt:result[4]})
    }finally{this.active--}
  }
  async prune(input:{readonly limit:number}):Promise<number>{bounded(input.limit,10_000);return 0}
}
