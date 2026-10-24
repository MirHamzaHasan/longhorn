import { openPostgres } from '@longhorn/node/postgres'
import { loadOperatorConfiguration } from './operator-environment.js'
import { loadConsoleAssets } from './console-assets.js'
import { checkOperatorApplication } from './operator-preflight.js'

const controller=new AbortController()
let interrupted:'SIGINT'|'SIGTERM'|undefined
const interrupt=()=>{interrupted??='SIGINT';controller.abort()}
const terminate=()=>{interrupted??='SIGTERM';controller.abort()}
process.on('SIGINT',interrupt);process.on('SIGTERM',terminate)
try{
  const report=await checkOperatorApplication({loadConfiguration:loadOperatorConfiguration,loadAssets:loadConsoleAssets,
    openDatabase:config=>openPostgres({connectionString:config.databaseUrl,maxConnections:config.maxConnections}),signal:controller.signal})
  console.log(JSON.stringify(report))
  process.exitCode=report.cancelled?(interrupted==='SIGINT'?130:143):report.ready?0:1
}finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate)}
