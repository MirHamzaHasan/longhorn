import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
type Descriptor = {
  schemaVersion: number; dependencies: Record<string,string>; devDependencies: Record<string,string>
  files: Record<string,string>
}
/** Trusted build assets with explicit files/hashes. No downloaded templates or arbitrary path selection. */
export async function readD1Template(framework:string) {
  const directory=join(framework,'templates/d1-tasks')
  let descriptor:Descriptor
  const files:Record<string,string>={}
  try{
    descriptor=JSON.parse(await readFile(join(directory,'template.json'),'utf8')) as Descriptor
    const record=(value:unknown)=>typeof value==='object'&&value!==null&&!Array.isArray(value)
    if(!record(descriptor)||descriptor.schemaVersion!==1||!record(descriptor.dependencies)||!record(descriptor.devDependencies)||!record(descriptor.files))throw new Error()
    for(const dependencies of [descriptor.dependencies,descriptor.devDependencies])for(const[name,version]of Object.entries(dependencies)){
      if(!/^(@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(name)||typeof version!=='string'||!version||version.length>128||(!name.startsWith('@longhorn/')&&/^(?:file:|link:|workspace:)/.test(version)))throw new Error()
    }
    const entries=Object.entries(descriptor.files)
    if(!entries.length||entries.length>128)throw new Error()
    let bytes=0
    for(const[path,hash]of entries){
      if(!/^[A-Za-z0-9_./-]+$/.test(path)||path.startsWith('/')||path.split('/').some(part=>!part||part==='.'||part==='..')||path.startsWith('.longhorn/')||['package.json','pnpm-workspace.yaml'].includes(path)||typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))throw new Error()
      const content=await readFile(join(directory,path));bytes+=content.byteLength
      if(bytes>2097152||content.byteLength>524288||createHash('sha256').update(content).digest('hex')!==hash)throw new Error()
      files[path]=new TextDecoder('utf-8',{fatal:true}).decode(content)
    }
    for(const path of ['README.md','build.mjs','build.config.mjs','serve.mjs','dev.mjs','src/index.ts','src/app.ts','src/deploy.ts','src/schema.ts','src/config.ts','src/tasks.ts','tests/storage.mjs','docs/features.md'])if(!(path in files))throw new Error()
    for(const name of ['@longhorn/core','@longhorn/container','@longhorn/config','@longhorn/database','@longhorn/idempotency','@longhorn/validation','@longhorn/workers','@longhorn/runtime'])if(!(name in descriptor.dependencies))throw new Error()
  }catch{throw new Error('D1 template assets are unavailable or invalid; rebuild the CLI distribution')}
  return {
    dependencies:descriptor.dependencies,
    projectFiles(name:string,dependencies:Record<string,string>,locations:Record<string,string>):Record<string,string>{
      return {...files,
        'README.md':files['README.md']!.replaceAll('{{PROJECT_NAME}}',name),
        'package.json':JSON.stringify({name,version:'0.0.0',private:true,type:'module',packageManager:'pnpm@12.6.0',engines:{node:'>=20.19.0'},longhorn:{schemaVersion:1,runtime:'workers',framework:'snapshot',template:'d1-tasks'},scripts:{dev:'node dev.mjs',build:'node build.mjs',start:'node serve.mjs',typecheck:'tsc --noEmit',test:'vitest run','test:storage':'pnpm build && node tests/storage.mjs'},dependencies:{...Object.fromEntries(Object.entries(descriptor.dependencies).filter(([name])=>!name.startsWith('@longhorn/'))),...dependencies},devDependencies:descriptor.devDependencies},null,2)+'\n',
        'pnpm-workspace.yaml':'overrides:\n'+Object.entries(locations).map(([name,value])=>'  '+JSON.stringify(name)+': '+JSON.stringify(value)).join('\n')+'\n\nallowBuilds:\n  esbuild: true\n  workerd: true\n',
      }
    },
  }
}
