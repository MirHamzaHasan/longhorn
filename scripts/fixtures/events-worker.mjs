import { verifyEvents } from './events-contract.mjs'

export default { async fetch() { return Response.json(await verifyEvents()) } }
