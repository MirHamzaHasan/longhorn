import { verifyQueue } from './queue-contract.mjs'
export default { async fetch() {
  try { return Response.json(await verifyQueue()) }
  catch (error) { return Response.json({ error: String(error), stack: error.stack }, { status: 500 }) }
} }
