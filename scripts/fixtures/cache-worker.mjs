import { verifyCache } from './cache-contract.mjs'
export default {
  async fetch() {
    try { return Response.json(await verifyCache()) }
    catch (error) { return Response.json({ error: String(error), stack: error.stack }, { status: 500 }) }
  },
}
