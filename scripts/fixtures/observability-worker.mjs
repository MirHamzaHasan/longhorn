import { verifyObservability } from './observability-contract.mjs'
export default { async fetch() {
  try { return Response.json(await verifyObservability()) }
  catch (error) { return Response.json({ error: String(error), stack: error.stack }, { status: 500 }) }
} }
