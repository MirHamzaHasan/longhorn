import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { openPostgres } from '@longhornjs/node/postgres'

const [mode,destination,offline,...extra]=process.argv.slice(2)
let database,staging
class StateError extends Error {}
async function absent(path){try{await lstat(path);throw new StateError('Destination already exists')}catch(error){if(error.code!=='ENOENT')throw error}}
async function hash(file){const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);return digest.digest('hex')}
async function files(directory,prefix=''){
  const result=[]
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const relative=prefix+entry.name,file=join(directory,entry.name)
    if(entry.isDirectory())result.push(...await files(file,relative+'/'))
    else if(entry.isFile())result.push({path:relative,size:(await lstat(file)).size,sha256:await hash(file)})
    else throw new StateError('Backup storage must contain regular files and directories only')
  }
  return result.sort((a,b)=>a.path.localeCompare(b.path))
}
function run(binary,args,environment){return new Promise((resolve,reject)=>{const child=spawn(binary,args,{env:environment,stdio:['ignore','ignore','pipe']});child.stderr.resume();child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new StateError('PostgreSQL client failed')))})}
function connection(){
  const url=new URL(process.env.MIGRATION_DATABASE_URL??'')
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.username||url.pathname.length<2||url.search||url.hash)throw new StateError('Invalid deployment connection')
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PG')))
  return {...env,PGHOST:url.hostname.replace(/^\[|\]$/g,''),PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGSSLMODE:process.env.PGSSLMODE??'prefer'}
}
try{
  if(!['backup','restore'].includes(mode)||!destination||offline!=='--offline'||extra.length)throw new StateError('Usage: state:backup|state:restore DIRECTORY --offline (stop both hosts first)')
  if(!process.env.RECEIVER_DATA_PATH?.trim())throw new StateError('Explicit receiver storage path required')
  const path=resolve(destination),receiver=resolve(process.env.RECEIVER_DATA_PATH),environment=connection()
  if(path===receiver||path.startsWith(receiver+sep)||receiver.startsWith(path+sep))throw new StateError('Backup and receiver paths must be disjoint')
  const executable=name=>process.env.LONGHORN_PG_CLIENT_BIN?join(process.env.LONGHORN_PG_CLIENT_BIN,name):name
  database=await openPostgres({connectionString:process.env.MIGRATION_DATABASE_URL})
  const version=Number((await database.execute('SHOW server_version_num')).rows[0].server_version_num)
  if(version<180000||version>=190000)throw new StateError('This backup profile is verified for PostgreSQL 18')
  if(mode==='backup'){
    await absent(path)
    const info=await lstat(receiver);if(!info.isDirectory()||info.isSymbolicLink())throw new StateError('Invalid receiver directory')
    await files(receiver) // Reject symlinks and special files before copying.
    await mkdir(dirname(path),{recursive:true});staging=await mkdtemp(join(dirname(path),'.longhorn-backup-'))
    await cp(receiver,join(staging,'receiver'),{recursive:true,dereference:false})
    await run(executable('pg_dump'),['--format=custom','--compress=0','--no-owner','--no-acl','--file',join(staging,'database.dump')],environment)
    const metadata={schemaVersion:1,application:'longhorn-commands',postgresMajor:18,id:randomBytes(16).toString('hex'),createdAt:new Date().toISOString(),database:{sha256:await hash(join(staging,'database.dump'))},receiver:await files(join(staging,'receiver'))}
    await writeFile(join(staging,'manifest.json'),JSON.stringify(metadata,null,2)+'\n',{mode:0o600})
    await absent(path);await rename(staging,path);staging=undefined
    console.log('Offline state backup completed')
  }else{
    const metadata=JSON.parse(await readFile(join(path,'manifest.json'),'utf8'))
    if(metadata.schemaVersion!==1||metadata.application!=='longhorn-commands'||metadata.postgresMajor!==18||!Array.isArray(metadata.receiver))throw new StateError('Unsupported backup')
    if(metadata.database?.sha256!==await hash(join(path,'database.dump')))throw new StateError('Database backup checksum mismatch')
    if(JSON.stringify(metadata.receiver)!==JSON.stringify(await files(join(path,'receiver'))))throw new StateError('Receiver backup checksum mismatch')
    await absent(receiver)
    const occupied=(await database.execute("SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' LIMIT 1")).rows
    if(occupied.length)throw new StateError('Restore requires an empty, separately provisioned database')
    await mkdir(dirname(receiver),{recursive:true});staging=await mkdtemp(join(dirname(receiver),'.longhorn-restore-'))
    await cp(join(path,'receiver'),join(staging,'receiver'),{recursive:true,dereference:false})
    await database.execute('REVOKE ALL ON SCHEMA public FROM PUBLIC')
    await run(executable('pg_restore'),['--dbname='+environment.PGDATABASE,'--no-owner','--no-acl','--exit-on-error','--single-transaction',join(path,'database.dump')],environment)
    // --no-acl intentionally drops deployment-specific grants. Revoke the default
    // PUBLIC function execution before runtime grants can be reapplied.
    await database.execute('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA longhorn_auth FROM PUBLIC')
    await absent(receiver);await rename(join(staging,'receiver'),receiver)
    console.log('Offline state restored; run migrations and restricted runtime grants before starting hosts')
  }
}catch(error){if(error instanceof StateError)console.error(error.message);console.error('Offline state operation failed; verify stopped hosts, trusted backup, empty restore destinations, PostgreSQL 18 tools and owner configuration. Partial restore targets must be inspected before reuse.');process.exitCode=1}
finally{await database?.close();if(staging)await rm(staging,{recursive:true,force:true})}
