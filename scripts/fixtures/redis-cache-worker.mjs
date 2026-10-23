import { verifyRedisCacheProtocol } from './redis-cache-contract.mjs'
export default { async fetch() { return Response.json(await verifyRedisCacheProtocol()) } }
