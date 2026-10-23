import { verifyScheduler } from './scheduler-contract.mjs'
export default { async fetch() {
  try { return Response.json(await verifyScheduler()) }
  catch (error) { return Response.json({ error: String(error), stack: error.stack }, { status: 500 }) }
} }
