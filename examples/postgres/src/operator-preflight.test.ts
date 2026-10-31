import { beforeEach,expect,it,vi } from 'vitest'
import type { Database } from '@longhornjs/database'
import type { OperatorConfig } from './operator-config.js'
import { checkOperatorApplication } from './operator-preflight.js'
import { checkPostgresTables } from './postgres-readiness.js'
import { checkOperatorRuntimeRole } from './operator-runtime.js'

const probes=vi.hoisted(()=>({health:vi.fn()}))
vi.mock('./postgres-readiness.js',()=>({checkPostgresTables:vi.fn()}))
vi.mock('./operator-runtime.js',()=>({checkOperatorRuntimeRole:vi.fn()}))
vi.mock('./operation-transport.js',()=>({createOperationTransport:()=>({checkHealth:probes.health})}))
const config:OperatorConfig={databaseUrl:'postgres://private.example/secret-database',hostname:'127.0.0.1',port:0,logLevel:'info',maxConnections:1,
  authOrigin:'http://127.0.0.1:3011',secureCookies:false,sessionTtlMs:3600000,messageBaseUrl:'http://private.example',messageToken:'private-service-credential',allowInsecureLoopback:true,timeoutMs:100,dispatchEnabled:false}
function fixture(){
  const execute=vi.fn(async()=>({rows:[],rowsAffected:0,lastInsertId:undefined})),close=vi.fn(async()=>{})
  const database:Database={dialect:'postgres',execute,close,transaction:async()=>{throw new Error('Preflight must not transact')}}
  return{database,execute,close,loadConfiguration:vi.fn(async()=>config),loadAssets:vi.fn(async()=>{}),openDatabase:vi.fn(async()=>database)}
}
beforeEach(()=>{vi.resetAllMocks();probes.health.mockResolvedValue(true)})
it('returns only frozen versioned observations while reusing the enabled profile checks',async()=>{
  const f=fixture(),report=await checkOperatorApplication(f)
  expect(report).toEqual({schemaVersion:1,ready:true,cancelled:false,checks:['configuration','console-assets','database','schema','runtime-role','receiver','database-close'].map(id=>({id,status:'passed'})),capabilities:{dispatchEnabled:false,requestCleanupEnabled:false,commandLimitsEnabled:false}})
  expect(checkPostgresTables).toHaveBeenCalledWith(f.database,{passwordChanges:true,sessionControls:true,sessionInventory:true},{})
  expect(f.execute).toHaveBeenCalledExactlyOnceWith('SELECT 1');expect(f.close).toHaveBeenCalledTimes(1)
  expect(Object.isFrozen(report)&&Object.isFrozen(report.checks)&&report.checks.every(Object.isFrozen)).toBe(true)
  expect(JSON.stringify(report)).not.toContain('private')
})
it('checks cleanup access only for its explicit configured capability',async()=>{
  const f=fixture(),requestCleanup={limit:2,intervalMs:1000},report=await checkOperatorApplication({...f,loadConfiguration:async()=>({...config,requestCleanup})})
  expect(report.capabilities?.requestCleanupEnabled).toBe(true);expect(checkPostgresTables).toHaveBeenCalledWith(f.database,{passwordChanges:true,sessionControls:true,sessionInventory:true},{requestCleanup})
})
it('stops all acquisition after invalid configuration without reflecting its error',async()=>{
  const f=fixture();f.loadConfiguration.mockRejectedValue(new Error('private supplied URL/password'))
  const report=await checkOperatorApplication(f);expect(report.ready).toBe(false);expect(report.checks[0]).toMatchObject({id:'configuration',status:'failed'})
  expect(report.checks.slice(1).every(row=>row.status==='skipped')).toBe(true);expect(f.loadAssets).not.toHaveBeenCalled();expect(f.openDatabase).not.toHaveBeenCalled();expect(probes.health).not.toHaveBeenCalled();expect(JSON.stringify(report)).not.toContain('private')
})
it.each(['console-assets','schema','runtime-role','receiver'] as const)('keeps independent probes and closes after %s failure',async id=>{
  const f=fixture(),error=new Error('private service/query information')
  if(id==='console-assets')f.loadAssets.mockRejectedValue(error)
  else if(id==='schema')vi.mocked(checkPostgresTables).mockRejectedValue(error)
  else if(id==='runtime-role')vi.mocked(checkOperatorRuntimeRole).mockRejectedValue(error)
  else probes.health.mockRejectedValue(error)
  const report=await checkOperatorApplication(f);expect(report.ready).toBe(false);expect(report.checks.find(row=>row.id===id)).toMatchObject({status:'failed',hint:expect.any(String)})
  if(id==='schema')expect(checkOperatorRuntimeRole).not.toHaveBeenCalled()
  expect(probes.health).toHaveBeenCalledTimes(1);expect(f.close).toHaveBeenCalledTimes(1);expect(JSON.stringify(report)).not.toContain('private')
})
it('requires exact healthy acknowledgement rather than a resolved false response',async()=>{
  probes.health.mockResolvedValue(false);const report=await checkOperatorApplication(fixture());expect(report.ready).toBe(false);expect(report.checks.find(row=>row.id==='receiver')?.status).toBe('failed')
})
it('skips dependent SQL after acquisition failure while still inspecting the receiver',async()=>{
  const f=fixture();f.openDatabase.mockRejectedValue(new Error('private connection'))
  const report=await checkOperatorApplication(f);expect(report.checks.find(row=>row.id==='database')?.status).toBe('failed');expect(report.checks.find(row=>row.id==='database-close')?.status).toBe('skipped')
  expect(checkPostgresTables).not.toHaveBeenCalled();expect(f.close).not.toHaveBeenCalled();expect(probes.health).toHaveBeenCalledTimes(1)
})
it('retains ownership when its first SQL probe fails and reports close failure independently',async()=>{
  const f=fixture();f.execute.mockRejectedValue(new Error('private query'));f.close.mockRejectedValue(new Error('private close'))
  const report=await checkOperatorApplication(f);expect(report.checks.find(row=>row.id==='database')?.status).toBe('failed');expect(report.checks.at(-1)?.status).toBe('failed');expect(f.close).toHaveBeenCalledTimes(1);expect(checkPostgresTables).not.toHaveBeenCalled();expect(JSON.stringify(report)).not.toContain('private')
})
it('does no work after pre-abort and drains a connection acquired during interruption',async()=>{
  const f=fixture(),early=new AbortController();early.abort();const skipped=await checkOperatorApplication({...f,signal:early.signal});expect(skipped.cancelled).toBe(true);expect(f.loadConfiguration).not.toHaveBeenCalled()
  let acquired!:(database:Database)=>void,entered!:()=>void,finish!:()=>void,closing!:()=>void
  const opening=new Promise<void>(done=>{entered=done}),closeEntered=new Promise<void>(done=>{closing=done}),controller=new AbortController()
  f.openDatabase.mockImplementation(()=>{entered();return new Promise(done=>{acquired=done})});f.close.mockImplementation(()=>{closing();return new Promise<void>(done=>{finish=done})})
  let settled=false;const work=checkOperatorApplication({...f,signal:controller.signal}).then(value=>{settled=true;return value})
  await opening;controller.abort();acquired(f.database);await closeEntered;expect(settled).toBe(false);expect(f.execute).not.toHaveBeenCalled();expect(probes.health).not.toHaveBeenCalled();finish()
  const report=await work;expect(report.ready).toBe(false);expect(report.cancelled).toBe(true);expect(report.checks.find(row=>row.id==='database')?.status).toBe('cancelled');expect(report.checks.at(-1)?.status).toBe('passed')
})
it('forwards cancellation but waits for admitted receiver work before pool close',async()=>{
  const f=fixture(),controller=new AbortController();let release!:(value:boolean)=>void,entered!:()=>void;const admitted=new Promise<void>(done=>{entered=done})
  probes.health.mockImplementation(async(signal:AbortSignal)=>{expect(signal).toBe(controller.signal);entered();return new Promise<boolean>(done=>{release=done})})
  const work=checkOperatorApplication({...f,signal:controller.signal});await admitted;controller.abort();expect(f.close).not.toHaveBeenCalled();release(true)
  const report=await work;expect(report.cancelled).toBe(true);expect(report.checks.find(row=>row.id==='receiver')?.status).toBe('cancelled');expect(f.close).toHaveBeenCalledTimes(1)
})
