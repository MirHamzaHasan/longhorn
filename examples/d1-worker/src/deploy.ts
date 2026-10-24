import{createD1}from'@longhorn/workers/d1'
import type{D1Binding}from'@longhorn/workers/d1'
import{migrateSqliteBatch}from'@longhorn/database/batch'
import{migrations}from'./schema.js'
/** Trusted deployment-only worker, called privately by local tooling. Never routed by the application. */
export default{async fetch(_request:Request,bindings:{DB:D1Binding}):Promise<Response>{
  const database=createD1(bindings.DB)
  try{return Response.json({applied:await migrateSqliteBatch(database,migrations)})}
  catch{return Response.json({error:'D1 schema deployment failed'}, {status:500})}
  finally{await database.close()}
}}
