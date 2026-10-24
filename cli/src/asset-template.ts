import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
type Descriptor={schemaVersion:number;dependencies:Record<string,string>;devDependencies:Record<string,string>;files:Record<string,string>}
export type AssetProfile={
  readonly name:'d1-tasks'|'sqlite-tasks';readonly label:string;readonly runtime:'workers'|'node'|'bun'
  readonly assetName?:'bun-sqlite-tasks'
  readonly requiredFiles:readonly string[];readonly requiredDependencies:readonly string[]
  readonly scripts:Readonly<Record<string,string>>;readonly allowBuilds:readonly string[]
}
/** Read a named trusted local distribution; hashes are corruption checks, not signatures. */
export async function readAssetTemplate(framework:string,profile:AssetProfile){
  const directory=join(framework,'templates',profile.assetName??profile.name),files:Record<string,string>=Object.create(null)
  let descriptor:Descriptor
  try{
    descriptor=JSON.parse(await readFile(join(directory,'template.json'),'utf8')) as Descriptor
    const record=(value:unknown)=>typeof value==='object'&&value!==null&&!Array.isArray(value)
    if(!record(descriptor)||descriptor.schemaVersion!==1||!record(descriptor.dependencies)||!record(descriptor.devDependencies)||!record(descriptor.files))throw new Error()
    for(const dependencies of[descriptor.dependencies,descriptor.devDependencies])for(const[name,version]of Object.entries(dependencies)){
      if(!/^(@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(name)||typeof version!=='string'||!version||version.length>128||(!name.startsWith('@longhorn/')&&/^(?:file:|link:|workspace:)/.test(version)))throw new Error()
    }
    const entries=Object.entries(descriptor.files);if(!entries.length||entries.length>128)throw new Error()
    let bytes=0
    for(const[path,hash]of entries){
      if(!/^[A-Za-z0-9_./-]+$/.test(path)||path.startsWith('/')||path.split('/').some(part=>!part||part==='.'||part==='..')||path.startsWith('.longhorn/')||['package.json','pnpm-workspace.yaml'].includes(path)||typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))throw new Error()
      const content=await readFile(join(directory,path));bytes+=content.byteLength
      if(bytes>2097152||content.byteLength>524288||createHash('sha256').update(content).digest('hex')!==hash)throw new Error()
      files[path]=new TextDecoder('utf-8',{fatal:true}).decode(content)
    }
    for(const path of profile.requiredFiles)if(!(path in files))throw new Error()
    for(const name of profile.requiredDependencies)if(!(name in descriptor.dependencies))throw new Error()
  }catch{throw new Error(profile.label+' template assets are unavailable or invalid; rebuild the CLI distribution')}
  return {dependencies:descriptor.dependencies,projectFiles(name:string,dependencies:Record<string,string>,locations:Record<string,string>):Record<string,string>{
    return {...files,'README.md':files['README.md']!.replaceAll('{{PROJECT_NAME}}',name),
      'package.json':JSON.stringify({name,version:'0.0.0',private:true,type:'module',packageManager:'pnpm@12.6.0',engines:{node:'>=20.19.0'},longhorn:{schemaVersion:1,runtime:profile.runtime,framework:'snapshot',template:profile.name},scripts:profile.scripts,dependencies:{...Object.fromEntries(Object.entries(descriptor.dependencies).filter(([name])=>!name.startsWith('@longhorn/'))),...dependencies},devDependencies:descriptor.devDependencies},null,2)+'\n',
      'pnpm-workspace.yaml':'overrides:\n'+Object.entries(locations).map(([name,value])=>'  '+JSON.stringify(name)+': '+JSON.stringify(value)).join('\n')+'\n\nallowBuilds:\n'+profile.allowBuilds.map(name=>'  '+name+': true\n').join(''),
    }
  }}
}
