import { cleanupContract } from './cleanup-contract.mjs'
export default{async fetch(){return Response.json({runtime:'workerd',...await cleanupContract()})}}
