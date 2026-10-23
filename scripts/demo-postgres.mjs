import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {startPostgresSandbox} from './postgres-sandbox.mjs'
console.log('Starting a temporary PostgreSQL demo. Ctrl+C stops it and removes its demo data.')
let host,closing,requested=false
const starting=startPostgresSandbox()
const ended=()=>new Promise(resolve=>{if(host.exitCode!==null||host.signalCode!==null)resolve();else host.once('close',resolve)})
async function shutdown(){
 requested=true
 closing??=(async()=>{
   let sandbox
   try{sandbox=await starting;host?.kill('SIGTERM');if(host){const timeout=setTimeout(()=>host.kill('SIGKILL'),10000);try{await ended()}finally{clearTimeout(timeout)}}}
   finally{await sandbox?.stop()}
 })()
 return closing
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void shutdown().catch(()=>{process.exitCode=1})})
try{
 const sandbox=await starting
 if(!requested){
   host=spawn(process.execPath,[fileURLToPath(new URL('../examples/postgres/dist/index.js',import.meta.url))],{
     stdio:'inherit',env:{...process.env,DATABASE_URL:sandbox.appUrl,HOST:'127.0.0.1',PORT:process.env.PORT??'3003',LOG_LEVEL:'info'},
   })
   host.on('error',()=>{process.exitCode=1})
   await ended()
   if(!requested&&host.exitCode)process.exitCode=host.exitCode
 }
}catch{console.error('PostgreSQL demo failed. Check native binary support and build output.');process.exitCode=1}
finally{await shutdown()}
