import { loadConfig } from '@longhorn/config'
import { createLogger } from '@longhorn/logger'
import { readEnv } from '@longhorn/node/config'
import { openRedis } from '@longhorn/node/redis'
import { nodeRuntime } from '@longhorn/node'
import type { Longhorn } from '@longhorn/core'
import { redisLimitsConfig } from './config.js'
import { createRedisLimitsApp } from './app.js'
let app:Longhorn|undefined,requested=false,closing:Promise<void>|undefined
const bootstrap=createLogger({bindings:{app:'redis-limits'}})
function shutdown(){requested=true;return closing??=Promise.allSettled([starting,app?.close()??Promise.resolve()]).then(([,stopped])=>{if(stopped.status==='rejected')throw stopped.reason})}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void shutdown().catch(()=>{bootstrap.error('Redis limits shutdown failed');process.exitCode=1})})
const starting=(async()=>{
  const config=await loadConfig(redisLimitsConfig,await readEnv({files:[new URL('../.env',import.meta.url),new URL('../.env.local',import.meta.url)],ignoreMissing:true}))
  if(requested)return
  const logger=createLogger({level:config.logLevel,bindings:{app:'redis-limits'}})
  app=createRedisLimitsApp({...config,logger,openClient:()=>openRedis(config.redis)}).onStop(()=>{logger.info('Application stopped')})
  const server=await app.listen(nodeRuntime,{hostname:config.hostname,port:config.port})
  if(!requested)logger.info('HTTP server listening',{url:server.url,rateLimit:'redis'})
})()
try{await starting}catch{if(!requested){bootstrap.error('Redis limits startup failed; verify configuration and Redis access');process.exitCode=1};await shutdown()}
