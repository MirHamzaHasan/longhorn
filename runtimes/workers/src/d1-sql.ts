/** A conservative SQLite statement boundary scanner; CREATE TRIGGER bodies stay one statement. */
export function d1Sql(sql:string):void{
  const words:string[]=[]
  let index=0,terminated=false,trigger=false,body=false,ended=false,cases=0,previous=''
  while(index<sql.length){
    const char=sql[index]!
    if(/\s/.test(char)){index++;continue}
    if(sql.startsWith('--',index)){const end=sql.indexOf('\n',index+2);index=end<0?sql.length:end+1;continue}
    if(sql.startsWith('/*',index)){const end=sql.indexOf('*/',index+2);if(end<0)throw new Error();index=end+2;continue}
    if(terminated)throw new Error()
    if(char===';'&&(!trigger||ended)){if(!words.length)throw new Error();terminated=true;index++;continue}
    if(ended)throw new Error()
    if(char==="'"||char==='"'||char==='`'||char==='['){
      const end=char==='['?']':char;index++;let closed=false
      while(index<sql.length){if(sql[index]!==end){index++;continue}index++;if(char!=='['&&sql[index]===end){index++;continue}closed=true;break}
      if(!closed)throw new Error();previous='quoted';continue
    }
    const match=/^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(index))
    if(!match){previous=char;index++;continue}
    const word=match[0].toUpperCase();index+=match[0].length
    if(words.length<4){words.push(word);trigger=words[0]==='CREATE'&&(words[1]==='TRIGGER'||(['TEMP','TEMPORARY'].includes(words[1]!)&&words[2]==='TRIGGER'))}
    if(trigger&&previous!=='.'){
      if(word==='CASE')cases++
      else if(word==='END'){if(cases)cases--;else if(body&&previous===';')ended=true}
      else if(word==='BEGIN'&&!cases){if(body)throw new Error();body=true}
    }
    previous=word
  }
  if(!words.length||['BEGIN','START','COMMIT','END','ROLLBACK','ABORT','SAVEPOINT','RELEASE'].includes(words[0]!)||(trigger&&(!body||!ended)))throw new Error()
}
