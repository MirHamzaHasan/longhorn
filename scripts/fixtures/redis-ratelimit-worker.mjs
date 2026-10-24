import { verifyRedisRateLimitProtocol } from './redis-ratelimit-contract.mjs'
export default {async fetch(){return Response.json({runtime:'workerd',...await verifyRedisRateLimitProtocol()})}}
