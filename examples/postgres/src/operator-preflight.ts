import type { Database } from '@longhornjs/database'
import type { OperatorConfig } from './operator-config.js'
import { checkPostgresTables } from './postgres-readiness.js'
import { checkOperatorRuntimeRole } from './operator-runtime.js'
import { createOperationTransport } from './operation-transport.js'

export type OperatorCheckId = 'configuration'|'console-assets'|'database'|'schema'|'runtime-role'|'receiver'|'database-close'
export type OperatorCheckResult = { readonly id: OperatorCheckId; readonly status: 'passed'|'failed'|'skipped'|'cancelled'; readonly hint?: string }
export type OperatorPreflightReport = {
  readonly schemaVersion: 1
  readonly ready: boolean
  readonly cancelled: boolean
  readonly checks: readonly OperatorCheckResult[]
  readonly capabilities?: { readonly dispatchEnabled: boolean; readonly requestCleanupEnabled: boolean; readonly commandLimitsEnabled: boolean }
}
type Outcome<T> = {ok:true;value:T}|{ok:false}
const hints: Record<OperatorCheckId,string> = {
  configuration: 'Review runtime profile values in docs/setup.md; keep migration credentials out of the runtime shell.',
  'console-assets': 'Run pnpm build and check the readable built console assets.',
  database: 'Check runtime database connectivity and PostgreSQL configuration.',
  schema: 'Deploy the complete owner migration profile and provision its runtime grants; see docs/schema.md.',
  'runtime-role': 'Use the dedicated restricted runtime role described in docs/setup.md.',
  receiver: 'Check the protected receiver, credential, storage health and runtime transport settings.',
  'database-close': 'The acquired database did not close successfully; inspect its resource owner.',
}

/** Read-only app-local probes. Acquired database lifetime always outlives admitted work. */
export async function checkOperatorApplication(options: {
  readonly loadConfiguration: () => Promise<OperatorConfig>
  readonly loadAssets: () => Promise<unknown>
  readonly openDatabase: (config: OperatorConfig) => Promise<Database>
  readonly signal?: AbortSignal
}): Promise<OperatorPreflightReport> {
  const checks: OperatorCheckResult[] = []
  let database: Database|undefined,capabilities: OperatorPreflightReport['capabilities']
  const signal=options.signal??new AbortController().signal
  function skipped(id:OperatorCheckId){checks.push({id,status:'skipped'})}
  async function probe<T>(id:OperatorCheckId,work:()=>Promise<T>):Promise<Outcome<T>>{
    if(signal.aborted){skipped(id);return{ok:false}}
    try{
      const value=await work()
      checks.push(signal.aborted?{id,status:'cancelled'}:{id,status:'passed'})
      return signal.aborted?{ok:false}:{ok:true,value}
    }catch{
      checks.push(signal.aborted?{id,status:'cancelled'}:{id,status:'failed',hint:hints[id]})
      return{ok:false}
    }
  }
  try{
    const configuration=await probe('configuration',options.loadConfiguration)
    if(configuration.ok){
      const config=configuration.value
      capabilities={dispatchEnabled:config.dispatchEnabled,requestCleanupEnabled:!!config.requestCleanup,commandLimitsEnabled:!!config.commandLimits}
      await probe('console-assets',options.loadAssets)
      const connection=await probe('database',async()=>{
        database=await options.openDatabase(config)
        if(signal.aborted)return
        if(database.dialect!=='postgres')throw new Error('PostgreSQL is required')
        await database.execute('SELECT 1')
      })
      if(connection.ok){
        const schema=await probe('schema',()=>checkPostgresTables(database!,{passwordChanges:true,sessionControls:true,sessionInventory:true},{...(config.requestCleanup?{requestCleanup:config.requestCleanup}:{}),...(config.commandLimits?{commandLimits:config.commandLimits}:{})}))
        if(schema.ok)await probe('runtime-role',()=>checkOperatorRuntimeRole(database!));else skipped('runtime-role')
      }else{skipped('schema');skipped('runtime-role')}
      await probe('receiver',async()=>{if(await createOperationTransport(config).checkHealth!(signal)!==true)throw new Error('Receiver health failed')})
    }else for(const id of ['console-assets','database','schema','runtime-role','receiver'] as const)skipped(id)
  }finally{
    if(database){
      try{await database.close();checks.push({id:'database-close',status:'passed'})}
      catch{checks.push({id:'database-close',status:'failed',hint:hints['database-close']})}
    }else skipped('database-close')
  }
  const cancelled=signal.aborted
  return Object.freeze({schemaVersion:1,ready:!cancelled&&checks.every(row=>row.status==='passed'),cancelled,
    checks:Object.freeze(checks.map(row=>Object.freeze(row))),...(capabilities?{capabilities:Object.freeze(capabilities)}:{})})
}
