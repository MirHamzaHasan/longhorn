import { createLogger } from '@longhornjs/logger'
import { openPostgres } from '@longhornjs/node/postgres'
import { nodeRuntime } from '@longhornjs/node'
import { createScryptPasswordHasher } from '@longhornjs/node/passwords'
import type { Longhorn } from '@longhornjs/core'
import { createPostgresApp } from './app.js'
import { loadOperatorConfiguration } from './operator-environment.js'
import { createOperationTransport } from './operation-transport.js'
import { checkOperatorRuntimeRole } from './operator-runtime.js'
import { loadConsoleAssets } from './console-assets.js'

let app: Longhorn | undefined,requested=false,closing: Promise<void> | undefined
const bootstrap=createLogger({bindings:{app:'operator-host'}})
async function shutdown(){
  requested=true
  return closing??=(async()=>{await starting.catch(()=>{});await app?.close()})()
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void shutdown().catch(()=>{bootstrap.error('Operator shutdown failed');process.exitCode=1})})
const starting=(async()=>{
  const config=await loadOperatorConfiguration()
  if(requested)return
  const logger=createLogger({level:config.logLevel,bindings:{app:'operator-host'}})
  app=createPostgresApp({logger,workerEnabled:false,schedulerEnabled:false,console:await loadConsoleAssets(),
    accounts:{origin:config.authOrigin,secure:config.secureCookies,sessionTtlMs:config.sessionTtlMs,passwords:createScryptPasswordHasher(),passwordChanges:true,sessionControls:true,sessionInventory:true},
    operations:{...createOperationTransport(config),...(config.commandLimits?{commandLimits:config.commandLimits}:{}),...(config.requestCleanup?{requestCleanup:{...config.requestCleanup,onError:()=>{logger.warn('Expired request cleanup failed')}}}:{})},openDatabase:async()=>{
      const database=await openPostgres({connectionString:config.databaseUrl,maxConnections:config.maxConnections})
      try{await checkOperatorRuntimeRole(database);return database}catch(error){await database.close();throw error}
    },
  }).onStop(()=>{logger.info('Application stopped')})
  const server=await app.listen(nodeRuntime,{hostname:config.hostname,port:config.port})
  if(!requested)logger.info('HTTP server listening',{url:server.url,dispatchEnabled:config.dispatchEnabled,requestCleanupEnabled:!!config.requestCleanup,commandLimitsEnabled:!!config.commandLimits})
})()
try{await starting}catch{bootstrap.error('Operator startup failed; verify runtime configuration, grants and deployed operations migrations');process.exitCode=1;await shutdown()}
