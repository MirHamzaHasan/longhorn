import type{BatchDatabase,SqlRow}from'@longhorn/database'
import{z}from'zod'
const taskSchema=z.object({id:z.string().uuid(),title:z.string().min(1).max(200),completed:z.boolean(),revision:z.number().int().min(1).max(2147483647),createdAt:z.string().datetime(),updatedAt:z.string().datetime()})
export type Task=z.output<typeof taskSchema>
type Positioned={task:Task;position:string}
const columns='CAST(position AS TEXT) AS position,id,title,completed,revision,created_at,updated_at'
function position(value:unknown):string{if(typeof value!=='string'||!/^[1-9]\d{0,18}$/.test(value)||BigInt(value)>9223372036854775807n)throw new Error('Invalid stored position');return value}
function task(row:SqlRow):Positioned{
  if(row.completed!==0&&row.completed!==1)throw new Error('Invalid stored task state')
  return {position:position(row.position),task:taskSchema.parse({id:row.id,title:row.title,completed:row.completed===1,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at})}
}
export class D1TasksStore{
  constructor(private readonly database:BatchDatabase){}
  async list(after:string,limit:number){
    const rows=(await this.database.execute({sql:`SELECT ${columns} FROM d1_tasks WHERE position>? ORDER BY position LIMIT ?`,args:[after,limit+1]})).rows.map(task)
    return {tasks:rows.slice(0,limit).map(row=>row.task),nextCursor:rows.length>limit?rows[limit-1]!.position:null}
  }
  async get(id:string):Promise<Task|undefined>{const row=(await this.database.execute({sql:`SELECT ${columns} FROM d1_tasks WHERE id=?`,args:[id]})).rows[0];return row?task(row).task:undefined}
  async create(title:string):Promise<Task>{
    const id=crypto.randomUUID(),mutation=crypto.randomUUID(),at=new Date().toISOString()
    const results=await this.database.batch([
      {sql:`INSERT INTO d1_tasks(id,title,completed,revision,created_at,updated_at,mutation) VALUES(?,?,0,1,?,?,?) RETURNING ${columns}`,args:[id,title,at,at,mutation]},
      {sql:"INSERT INTO d1_task_activity(task_id,revision,kind,at,mutation) VALUES(?,1,'created',?,?)",args:[id,at,mutation]},
    ])
    return task(results[0]!.rows[0]!).task
  }
  async update(id:string,input:{revision:number;title?:string|undefined;completed?:boolean|undefined}){
    const mutation=crypto.randomUUID(),at=new Date().toISOString()
    const results=await this.database.batch([
      {sql:`UPDATE d1_tasks SET title=COALESCE(?,title),completed=COALESCE(?,completed),revision=revision+1,updated_at=?,mutation=? WHERE id=? AND revision=? AND revision<2147483647 RETURNING ${columns}`,args:[input.title??null,input.completed??null,at,mutation,id,input.revision]},
      {sql:"INSERT INTO d1_task_activity(task_id,revision,kind,at,mutation) SELECT id,revision,'updated',updated_at,mutation FROM d1_tasks WHERE id=? AND mutation=?",args:[id,mutation]},
      {sql:`SELECT ${columns} FROM d1_tasks WHERE id=?`,args:[id]},
    ])
    const changed=results[0]!.rows[0],current=results[2]!.rows[0]
    if(changed)return {status:'updated' as const,task:task(changed).task}
    return current?{status:'conflict' as const,currentRevision:task(current).task.revision}:{status:'missing' as const}
  }
  async delete(id:string,revision:number){
    const at=new Date().toISOString(),mutation=crypto.randomUUID()
    const results=await this.database.batch([
      {sql:"INSERT INTO d1_task_activity(task_id,revision,kind,at,mutation) SELECT id,revision+1,'deleted',?,? FROM d1_tasks WHERE id=? AND revision=?",args:[at,mutation,id,revision]},
      {sql:'DELETE FROM d1_tasks WHERE id=? AND revision=? RETURNING id',args:[id,revision]},
      {sql:`SELECT ${columns} FROM d1_tasks WHERE id=?`,args:[id]},
    ])
    if(results[1]!.rows.length)return {status:'deleted' as const}
    const current=results[2]!.rows[0];return current?{status:'conflict' as const,currentRevision:task(current).task.revision}:{status:'missing' as const}
  }
  async activity(after:string,limit:number,id?:string){
    const rows=(await this.database.execute({sql:`SELECT CAST(position AS TEXT) AS position,task_id,revision,kind,at FROM d1_task_activity WHERE position>?${id?' AND task_id=?':''} ORDER BY position LIMIT ?`,args:id?[after,id,limit+1]:[after,limit+1]})).rows
    const entries=rows.slice(0,limit).map(row=>({position:position(row.position),taskId:z.string().uuid().parse(row.task_id),revision:z.number().int().min(1).max(2147483648).parse(row.revision),kind:z.enum(['created','updated','deleted']).parse(row.kind),at:z.string().datetime().parse(row.at)}))
    return {activity:entries,nextCursor:rows.length>limit?entries.at(-1)!.position:null}
  }
}
