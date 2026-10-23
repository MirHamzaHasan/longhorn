import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, access, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// QA-only native tools. Never installs globally or starts a database service.
const root=fileURLToPath(new URL('..',import.meta.url)),record=join(root,'.artifacts/postgres-clients.json')
try{const value=JSON.parse(await readFile(record,'utf8'));await access(join(value.directory,'pg_dump'));await access(join(value.directory,'pg_restore'));console.log(JSON.stringify(value));process.exit(0)}catch{}
const directory=await mkdtemp(join(tmpdir(),'longhorn-pg18-clients-')),source=join(directory,'postgresql-18.4'),prefix=join(directory,'install')
function run(binary,args,cwd=source){return new Promise((resolve,reject)=>{const child=spawn(binary,args,{cwd,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',chunk=>{output+=chunk});child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(output.slice(-8000))))})}
try{
  const response=await fetch('https://ftp.postgresql.org/pub/source/v18.4/postgresql-18.4.tar.bz2');if(!response.ok)throw new Error('PostgreSQL source download failed')
  const data=Buffer.from(await response.arrayBuffer())
  if(createHash('sha256').update(data).digest('hex')!=='81a81ec695fb0c7901407defaa1d2f7973617154cf27ba74e3a7ab8e64436094')throw new Error('PostgreSQL source checksum mismatch')
  const archive=join(directory,'source.tar.bz2');await writeFile(archive,data);await run('tar',['-xjf',archive,'-C',directory],directory)
  await run('./configure',['--prefix='+prefix,'--without-icu','--without-readline','--without-zlib','--without-lz4','--without-zstd','--without-openssl'])
  await run('make',['-C','src/backend','generated-headers'])
  await run('make',['-j4','-C','src/bin/pg_dump']);await run('make',['-C','src/interfaces/libpq','install']);await run('make',['-C','src/bin/pg_dump','install'])
  await mkdir(join(root,'.artifacts'),{recursive:true})
  const value={directory:join(prefix,'bin'),version:'18.4',source:'https://ftp.postgresql.org/pub/source/v18.4/',sha256:'81a81ec695fb0c7901407defaa1d2f7973617154cf27ba74e3a7ab8e64436094'}
  await writeFile(record,JSON.stringify(value,null,2)+'\n');console.log(JSON.stringify(value))
}catch(error){await rm(directory,{recursive:true,force:true});throw error}
